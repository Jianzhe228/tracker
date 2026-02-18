#[tauri::command]
pub fn health_check() -> String {
  "ok".to_string()
}

#[tauri::command]
pub fn app_version() -> String {
  env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn is_debug_build() -> bool {
  cfg!(debug_assertions)
}
