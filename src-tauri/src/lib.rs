use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::Manager;

/// Разрешённые сервисы ИИ (все OpenAI-совместимые). Кроме Groq — работают в РФ без VPN.
fn allowed_api(url: &str) -> bool {
    const ALLOWED: [&str; 9] = [
        "https://api.groq.com/",
        "https://openrouter.ai/",
        "https://api.cerebras.ai/",
        "https://api.siliconflow.com/",
        "https://api.siliconflow.cn/",
        "https://open.bigmodel.cn/",
        "https://integrate.api.nvidia.com/",
        "https://api.deepinfra.com/",
        "https://api.novita.ai/",
    ];
    ALLOWED.iter().any(|a| url.starts_with(a)) || url.starts_with("https://models.github.ai/")
}

/// Один HTTP-клиент на всё приложение + таймаут. Генерация плана бывает долгой (медленные
/// бесплатные модели) — держим большой потолок, чтобы легитимный запрос не обрывался.
///
/// `.no_proxy()` КРИТИЧНО: по умолчанию reqwest читает системный прокси (HTTP_PROXY/HTTPS_PROXY,
/// WinINET) и гонит через него весь трафик. VPN-клиенты прокси-типа (частый кейс в РФ) прописывают
/// туда 127.0.0.1:порт; когда пользователь выключает VPN для теста, этот прокси мёртв/кривой —
/// запрос ломается или возвращает мусор («Api key is invalid» → «0 моделей», пустой ответ).
/// Выбранные провайдеры доступны из РФ НАПРЯМУЮ, поэтому всегда идём в обход прокси.
fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(150))
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
#[tauri::command]
async fn llm_request(api_key: String, body: String, base: String) -> Result<String, String> {
    let url = format!("{}/chat/completions", base.trim_end_matches('/'));
    if !allowed_api(&url) {
        return Err("Недопустимый адрес сервиса ИИ".into());
    }
    let resp = http()
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("X-Title", "Nous")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

/// Стриминговый запрос к провайдеру (SSE, `"stream": true` в теле): куски текста уходят
/// на фронт через Channel ПО МЕРЕ генерации — ответ виден сразу, а не после полной генерации.
/// Возвращает собранный полный текст.
#[tauri::command]
async fn llm_stream(
    api_key: String,
    body: String,
    base: String,
    on_chunk: tauri::ipc::Channel<String>,
) -> Result<String, String> {
    use futures_util::StreamExt;
    let url = format!("{}/chat/completions", base.trim_end_matches('/'));
    if !allowed_api(&url) {
        return Err("Недопустимый адрес сервиса ИИ".into());
    }
    let resp = http()
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .header("X-Title", "Nous")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        // Из JSON-ошибки достаём человеческое сообщение, иначе шлём начало тела как есть.
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v["error"]["message"]
                    .as_str()
                    .or_else(|| v["message"].as_str())
                    .map(String::from)
            })
            .unwrap_or_else(|| text.chars().take(300).collect());
        return Err(format!("HTTP {}: {}", code, msg));
    }
    let mut full = String::new();
    let mut other = String::new(); // не-SSE строки: тело ошибки, пришедшее с кодом 200
    let mut buf: Vec<u8> = Vec::new(); // байтовый буфер: чанк может разрезать UTF-8 символ
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data == "[DONE]" {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(err) = v["error"]["message"].as_str() {
                        return Err(err.to_string());
                    }
                    if let Some(delta) = v["choices"][0]["delta"]["content"].as_str() {
                        if !delta.is_empty() {
                            full.push_str(delta);
                            let _ = on_chunk.send(delta.to_string());
                        }
                    }
                }
            } else if other.len() < 500 {
                other.push_str(line);
                other.push(' ');
            }
        }
    }
    if full.is_empty() {
        let msg = other.trim();
        if msg.is_empty() {
            return Err("Пустой ответ от сервиса ИИ".into());
        }
        return Err(msg.chars().take(300).collect());
    }
    Ok(full)
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
            llm_stream,
            llm_get,
            github_latest,
            export_state,
            reveal_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
