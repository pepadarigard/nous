use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Разрешённые сервисы ИИ: Groq (нужен VPN в РФ), OpenRouter/Cerebras (в РФ без VPN), YandexGPT (РФ).
fn allowed_api(url: &str) -> bool {
    url.starts_with("https://api.groq.com/")
        || url.starts_with("https://openrouter.ai/")
        || url.starts_with("https://api.cerebras.ai/")
        || url.starts_with("https://llm.api.cloud.yandex.net/")
}

// ===== GigaChat (Сбер): российский провайдер, гарантированно работает в РФ =====
// TLS у Сбера подписан НУЦ Минцифры — вшиваем их сертификаты, чтобы у пользователей
// работало без установки гос-сертификатов в систему.
const GIGA_OAUTH_URL: &str = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const GIGA_API_BASE: &str = "https://gigachat.devices.sberbank.ru/api/v1";

fn giga_http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        let root = reqwest::Certificate::from_pem(include_bytes!("../certs/russian_trusted_root_ca.pem"))
            .expect("root ca");
        let sub = reqwest::Certificate::from_pem(include_bytes!("../certs/russian_trusted_sub_ca.pem"))
            .expect("sub ca");
        reqwest::Client::builder()
            .add_root_certificate(root)
            .add_root_certificate(sub)
            .timeout(Duration::from_secs(90))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("giga client")
    })
}

/// Кэш access-токена GigaChat: (ключ авторизации, токен, истекает_ms).
fn giga_token_cache() -> &'static Mutex<Option<(String, String, u64)>> {
    static CACHE: OnceLock<Mutex<Option<(String, String, u64)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Получить access-токен (кэш ~25 минут; сам токен живёт 30).
async fn giga_access_token(auth_key: &str, force: bool) -> Result<String, String> {
    if !force {
        if let Some((k, tok, exp)) = giga_token_cache().lock().unwrap().clone() {
            if k == auth_key && now_ms() + 60_000 < exp {
                return Ok(tok);
            }
        }
    }
    let resp = giga_http()
        .post(GIGA_OAUTH_URL)
        .header("Authorization", format!("Basic {}", auth_key))
        .header("RqUID", uuid::Uuid::new_v4().to_string())
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body("scope=GIGACHAT_API_PERS")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| format!("GigaChat oauth: не-JSON ответ ({})", status))?;
    let token = v["access_token"].as_str().ok_or_else(|| {
        let msg = v["message"].as_str().unwrap_or("нет access_token");
        format!("GigaChat: ключ авторизации не подошёл ({})", msg)
    })?;
    let expires = v["expires_at"].as_u64().unwrap_or(now_ms() + 25 * 60_000);
    *giga_token_cache().lock().unwrap() = Some((auth_key.to_string(), token.to_string(), expires));
    Ok(token.to_string())
}

/// Чат-запрос к GigaChat (OpenAI-подобное тело). При протухшем токене — один повтор.
#[tauri::command]
async fn giga_request(auth_key: String, body: String) -> Result<String, String> {
    let mut token = giga_access_token(&auth_key, false).await?;
    for attempt in 0..2 {
        let resp = giga_http()
            .post(format!("{}/chat/completions", GIGA_API_BASE))
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .body(body.clone())
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if status == 401 && attempt == 0 {
            token = giga_access_token(&auth_key, true).await?;
            continue;
        }
        return Ok(text);
    }
    Err("GigaChat: не удалось выполнить запрос".into())
}

/// GET к GigaChat API (список моделей / проверка ключа).
#[tauri::command]
async fn giga_get(auth_key: String, path: String) -> Result<String, String> {
    if !path.starts_with('/') || path.contains("..") {
        return Err("Недопустимый путь".into());
    }
    let token = giga_access_token(&auth_key, false).await?;
    let resp = giga_http()
        .get(format!("{}{}", GIGA_API_BASE, path))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

/// Один HTTP-клиент на всё приложение + таймаут, чтобы запрос не завис навсегда.
fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(75))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("reqwest client")
    })
}

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

fn is_valid_json(s: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(s).is_ok()
}

/// Загрузить сохранённое состояние (JSON-строка) или None.
/// Если основной файл битый (обрыв записи) — восстанавливаемся из бэкапа.
#[tauri::command]
fn load_state(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = state_path(&app)?;
    if let Ok(s) = fs::read_to_string(&path) {
        if is_valid_json(&s) {
            return Ok(Some(s));
        }
    }
    let bak = path.with_extension("json.bak");
    if let Ok(s) = fs::read_to_string(&bak) {
        if is_valid_json(&s) {
            return Ok(Some(s));
        }
    }
    Ok(None)
}

/// Сохранить состояние атомарно: старый файл → .bak, новое → .tmp → rename.
/// Так обрыв в любой момент не теряет данные (есть либо старый файл, либо бэкап).
#[tauri::command]
fn save_state(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = state_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if path.exists() {
        let _ = fs::copy(&path, path.with_extension("json.bak"));
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Прокси-запрос к провайдеру ИИ (OpenAI-совместимый chat/completions). Тело формируется на фронте.
/// auth_prefix: "Bearer" (по умолчанию) или "Api-Key" (YandexGPT).
#[tauri::command]
async fn llm_request(api_key: String, body: String, base: String, auth_prefix: Option<String>) -> Result<String, String> {
    let url = format!("{}/chat/completions", base.trim_end_matches('/'));
    if !allowed_api(&url) {
        return Err("Недопустимый адрес сервиса ИИ".into());
    }
    let prefix = auth_prefix.unwrap_or_else(|| "Bearer".into());
    let resp = http()
        .post(&url)
        .header("Authorization", format!("{} {}", prefix, api_key))
        .header("Content-Type", "application/json")
        .header("X-Title", "Nous")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

/// GET с авторизацией к провайдеру (список моделей, проверка ключа).
#[tauri::command]
async fn llm_get(api_key: String, url: String) -> Result<String, String> {
    if !allowed_api(&url) {
        return Err("Недопустимый адрес сервиса ИИ".into());
    }
    let resp = http()
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("X-Title", "Nous")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

/// Последний релиз репозитория на GitHub (для проверки обновлений).
#[tauri::command]
async fn github_latest(repo: String) -> Result<String, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    let resp = http()
        .get(&url)
        .header("User-Agent", "nous-app")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

/// Экспорт данных: пишет JSON-бэкап в папку «Загрузки», возвращает полный путь.
#[tauri::command]
fn export_state(app: tauri::AppHandle, data: String, file_name: String) -> Result<String, String> {
    let safe: String = file_name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let path = dir.join(safe);
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Показать файл в Проводнике (выделив его).
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            llm_request,
            llm_get,
            giga_request,
            giga_get,
            github_latest,
            export_state,
            reveal_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
