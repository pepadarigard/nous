use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
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
    // Локальные модели (Ollama, LM Studio) — на своей машине, ключ им не нужен.
    let local = url.starts_with("http://localhost:") || url.starts_with("http://127.0.0.1:");
    ALLOWED.iter().any(|a| url.starts_with(a)) || url.starts_with("https://models.github.ai/") || local
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

/// Файл банка заданий — отдельно от состояния.
///
/// Полная загрузка с Решу ЕГЭ — это тысячи заданий и мегабайты. Держать их в
/// state.json значит переписывать эти мегабайты при каждом ответе на задание.
/// Банк меняется редко, состояние — постоянно, поэтому файла два.
fn bank_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("bank.json"))
}

#[tauri::command]
fn load_bank(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = bank_path(&app)?;
    Ok(fs::read_to_string(&path).ok())
}

#[tauri::command]
fn save_bank(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = bank_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Пишем через временный файл: обрыв записи не должен превращать банк в мусор.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Разрешённые адреса банка заданий. Только Решу ЕГЭ и его хранилище картинок:
/// команда ходит в сеть без ключа, и открывать её на произвольный адрес нельзя.
fn allowed_bank(url: &str) -> bool {
    const HOSTS: [&str; 6] = [
        "https://rus-ege.sdamgia.ru/",
        "https://math-ege.sdamgia.ru/",
        "https://inf-ege.sdamgia.ru/",
        "https://phys-ege.sdamgia.ru/",
        "https://ege.sdamgia.ru/",
        "https://sdamgia.ru/",
    ];
    HOSTS.iter().any(|h| url.starts_with(h))
}

/// Страница банка заданий как текст. Ходит только по адресам из allowed_bank.
#[tauri::command]
async fn bank_get(url: String) -> Result<String, String> {
    if !allowed_bank(&url) {
        return Err("Недопустимый адрес банка заданий".into());
    }
    let resp = http()
        .get(&url)
        .header("User-Agent", "Nous/0.3 (подготовка к ЕГЭ; личное использование)")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Сайт ответил {}", resp.status().as_u16()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// Картинка-чертёж как base64. Без неё геометрическое задание нерешаемо, поэтому
/// чертежи кладём рядом с заданием и дальше показываем офлайн.
#[tauri::command]
async fn bank_image(url: String) -> Result<String, String> {
    if !allowed_bank(&url) {
        return Err("Недопустимый адрес картинки".into());
    }
    let resp = http()
        .get(&url)
        .header("User-Agent", "Nous/0.3 (подготовка к ЕГЭ; личное использование)")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Сайт ответил {}", resp.status().as_u16()));
    }
    let kind = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    // Больше двух мегабайт чертежей не бывает — защита от случайной тяжёлой ссылки.
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("Слишком большая картинка".into());
    }
    Ok(format!("data:{};base64,{}", kind, B64.encode(&bytes)))
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

// ---------- Свои материалы (файлы пользователя) ----------
//
// Оригинал файла кладём в <app_data>/materials/<id>.<ext>, извлечённый текст — в <id>.txt.
// В состоянии приложения (state.json) остаётся только описание — иначе файл состояния
// распухнет от текста учебников и каждое сохранение станет тяжёлым.

fn materials_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("materials");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Имя файла без сюрпризов: только то, что мы сами формируем (<id>.<ext>), без путей.
fn safe_file_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect()
}

/// Сохранить оригинал файла (данные приходят с фронта в base64).
#[tauri::command]
fn save_material(app: tauri::AppHandle, file_name: String, data_b64: String) -> Result<String, String> {
    let dir = materials_dir(&app)?;
    let bytes = B64
        .decode(data_b64.as_bytes())
        .map_err(|e| format!("не удалось раскодировать файл: {}", e))?;
    let path = dir.join(safe_file_name(&file_name));
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Сохранить извлечённый текст материала.
#[tauri::command]
fn save_material_text(app: tauri::AppHandle, id: String, text: String) -> Result<(), String> {
    let dir = materials_dir(&app)?;
    fs::write(dir.join(safe_file_name(&format!("{}.txt", id))), text).map_err(|e| e.to_string())
}

/// Прочитать извлечённый текст материала (None, если текста нет).
#[tauri::command]
fn load_material_text(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    let dir = materials_dir(&app)?;
    Ok(fs::read_to_string(dir.join(safe_file_name(&format!("{}.txt", id)))).ok())
}

/// Удалить материал: и оригинал, и текст.
#[tauri::command]
fn delete_material(app: tauri::AppHandle, id: String, file_name: Option<String>) -> Result<(), String> {
    let dir = materials_dir(&app)?;
    let _ = fs::remove_file(dir.join(safe_file_name(&format!("{}.txt", id))));
    if let Some(f) = file_name {
        let _ = fs::remove_file(dir.join(safe_file_name(&f)));
    }
    Ok(())
}

/// Полный путь к сохранённому оригиналу.
#[tauri::command]
fn material_path(app: tauri::AppHandle, file_name: String) -> Result<String, String> {
    let dir = materials_dir(&app)?;
    let path = dir.join(safe_file_name(&file_name));
    if !path.exists() {
        return Err("файл не найден".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Открыть файл системной программой (Windows).
#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
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
            load_bank,
            save_bank,
            bank_get,
            bank_image,
            github_latest,
            export_state,
            reveal_path,
            save_material,
            save_material_text,
            load_material_text,
            delete_material,
            material_path,
            open_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
