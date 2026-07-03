use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::Manager;

const GROQ_CHAT_URL: &str = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS_URL: &str = "https://api.groq.com/openai/v1/models";

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

/// Прокси-запрос к Groq (chat/completions). Тело формируется на фронте, ключ здесь.
#[tauri::command]
async fn groq_request(api_key: String, body: String) -> Result<String, String> {
    let resp = http()
        .post(GROQ_CHAT_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

/// Список моделей аккаунта (для проверки ключа).
#[tauri::command]
async fn groq_models(api_key: String) -> Result<String, String> {
    let resp = http()
        .get(GROQ_MODELS_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
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
            groq_request,
            groq_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
