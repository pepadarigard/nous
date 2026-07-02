use base64::{engine::general_purpose, Engine as _};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const GROQ_CHAT_URL: &str = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS_URL: &str = "https://api.groq.com/openai/v1/models";

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

/// Загрузить сохранённое состояние приложения (JSON-строка) или None.
#[tauri::command]
fn load_state(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = state_path(&app)?;
    if path.exists() {
        fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
    } else {
        Ok(None)
    }
}

/// Сохранить состояние приложения (JSON-строка).
#[tauri::command]
fn save_state(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = state_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, data).map_err(|e| e.to_string())
}

/// Прочитать выбранный пользователем файл и вернуть его содержимое в base64.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(general_purpose::STANDARD.encode(bytes))
}

/// Прокси-запрос к Groq (chat/completions). Тело формируется на фронте, ключ здесь.
#[tauri::command]
async fn groq_request(api_key: String, body: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
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
    let client = reqwest::Client::new();
    let resp = client
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
        .plugin(tauri_plugin_dialog::init())
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
            read_file_bytes,
            groq_request,
            groq_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
