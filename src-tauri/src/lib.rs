pub mod commands;

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![
      commands::health::health_check,
      commands::health::app_version,
    ])
    .run(tauri::generate_context!())
    .expect("failed to run tauri app");
}
