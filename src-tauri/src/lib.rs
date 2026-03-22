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
    .plugin(tauri_plugin_dialog::init())
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
      commands::notification::notification_create,
      commands::notification::notification_list,
      commands::notification::notification_mark_read,
      commands::notification::notification_mark_all_read,
      commands::notification::notification_unread_count,
      commands::focus_session::focus_session_create,
      commands::focus_session::focus_session_list,
      commands::focus_session::focus_session_stats,
      commands::focus_session::focus_session_project_distribution,
      commands::statistics::stats_overview,
      commands::statistics::stats_heatmap,
      commands::statistics::stats_day_hour_distribution,
      commands::statistics::task_completion_stats,
      commands::statistics::task_estimation_comparison,
      commands::data::data_export_json,
      commands::data::data_export_to_file,
      commands::data::data_import_from_file,
      commands::data::data_clear_all,
      commands::sync::webdav_test_connection,
      commands::sync::webdav_upload,
      commands::sync::webdav_download,
      commands::sync::webdav_sync_status,
      commands::ai::ai_skill_list,
      commands::ai::ai_skill_get,
      commands::ai::ai_skill_create,
      commands::ai::ai_skill_update,
      commands::ai::ai_skill_toggle,
      commands::ai::ai_job_create,
      commands::ai::ai_job_update,
      commands::ai::ai_job_list,
      commands::ai::ai_job_pending_actions,
      commands::pattern::pattern_list,
      commands::pattern::pattern_create,
      commands::pattern::pattern_update,
      commands::pattern::pattern_delete,
      commands::pattern::pattern_match,
      commands::learning::learn_record,
      commands::learning::learn_record_batch,
      commands::learning::learn_suggest,
      commands::learning::learn_stats,
      commands::learning::learn_known_keywords,
      commands::learning::history_suggest,
      commands::learning::feedback_record,
      commands::learning::feedback_rejected_titles,
      commands::learning::cluster_list,
      commands::learning::cluster_upsert,
      commands::learning::cluster_delete,
    ])
    .run(tauri::generate_context!())
    .expect("failed to run tauri app");
}
