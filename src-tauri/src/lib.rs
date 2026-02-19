pub mod commands;
pub mod db;
pub mod services;

use db::AppState;
use tauri::Manager;

/// Platform-specific display optimizations.
/// Called before the WebView is created so env vars take effect.
fn setup_display_env() {
  // Linux / WebKitGTK: the DMA-BUF renderer can produce blurry output
  // under Wayland fractional scaling. Falling back to shared-memory
  // rendering fixes this with negligible performance impact.
  #[cfg(target_os = "linux")]
  {
    if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
      std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
      std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
  }
}

pub fn run() {
  setup_display_env();

  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      app.manage(AppState::new(app.handle().clone()));
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::health::health_check,
      commands::health::app_version,
      commands::health::is_debug_build,
      commands::init::app_init,
      commands::task::task_list,
      commands::task::task_create,
      commands::task::task_update,
      commands::task::task_delete,
      commands::task::task_restore,
      commands::settings::settings_get_all,
      commands::settings::settings_set,
      commands::project::project_list,
      commands::project::project_create,
      commands::project::project_update,
      commands::project::project_delete,
      commands::recurring::recurring_rule_create,
      commands::recurring::recurring_rule_update,
      commands::recurring::recurring_rule_deactivate,
    ])
    .run(tauri::generate_context!())
    .expect("failed to run tauri app");
}
