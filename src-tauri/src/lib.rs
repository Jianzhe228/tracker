pub mod commands;
pub mod db;
pub mod services;

use db::AppState;
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri::WindowEvent;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

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

fn read_close_to_tray(app: &tauri::AppHandle) -> bool {
    let state = app.state::<AppState>();
    let db = match state.db().lock() {
        Ok(db) => db,
        Err(_) => return true,
    };
    let result: Result<String, _> = db.query_row(
        "SELECT value FROM user_settings WHERE key = 'closeToTray'",
        [],
        |row| row.get(0),
    );
    match result {
        Ok(val) => val != "false",
        Err(_) => true, // default: minimize to tray
    }
}

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;

    let menu = MenuBuilder::new(app)
        .item(&show_i)
        .separator()
        .item(&quit_i)
        .build()?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/32x32.png"
        ))?)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Smart Focus Tracker")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// One-time hint when the app first hides to the tray, so users don't assume
/// closing the window exited the app (the timer keeps running in background).
fn notify_tray_hint_once(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let Ok(db) = state.db().lock() else { return };
    let seen = db
        .query_row(
            "SELECT value FROM user_settings WHERE key = 'trayHintShown'",
            [],
            |row| row.get::<_, String>(0),
        )
        .is_ok();
    if seen {
        return;
    }
    let _ = db.execute(
        "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('trayHintShown', 'true')",
        [],
    );
    drop(db);

    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title("Smart Focus Tracker 仍在运行")
        .body("应用已最小化到系统托盘，计时与提醒会继续。可从托盘图标重新打开或退出。")
        .show();
}

/// Surface fatal init errors in a native dialog: with `windows_subsystem =
/// "windows"` there is no console, so a panic here would be invisible.
fn show_startup_failure(app: &tauri::AppHandle, error: &str) {
    let db_path = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("tracker.db").display().to_string())
        .unwrap_or_else(|_| "<应用数据目录>/tracker.db".to_string());
    app.dialog()
        .message(format!(
            "应用初始化失败：\n{error}\n\n数据库文件位置：\n{db_path}\n\n如提示数据库版本不兼容，请先备份该文件，再将其移走后重新启动。"
        ))
        .title("Smart Focus Tracker 无法启动")
        .kind(MessageDialogKind::Error)
        .blocking_show();
}

pub fn run() {
    setup_display_env();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 当另一个实例启动时，显示当前窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // In debug builds, let the window close so the Tauri CLI can
                // clean up the Vite dev server. In release builds, respect the
                // user's closeToTray setting.
                if cfg!(debug_assertions) {
                    return;
                }

                if read_close_to_tray(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                    notify_tray_hint_once(window.app_handle());
                }
            }
        })
        .setup(|app| {
            let state = match AppState::new(app.handle().clone()) {
                Ok(state) => state,
                Err(e) => {
                    show_startup_failure(app.handle(), &e);
                    std::process::exit(1);
                }
            };
            app.manage(state);
            setup_tray(app)?;

            // Start prediction scheduler
            services::prediction_scheduler::start_scheduler(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health::health_check,
            commands::health::app_version,
            commands::health::is_debug_build,
            commands::init::app_init,
            commands::task::task_list,
            commands::task::task_list_working_set,
            commands::task::task_list_archive,
            commands::task::task_status_counts,
            commands::task::task_create,
            commands::task::task_update,
            commands::task::task_delete,
            commands::task::task_restore,
            commands::settings::settings_get_all,
            commands::settings::settings_set,
            commands::tray::set_tray_tooltip,
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
            commands::statistics::stats_weekly_focus,
            commands::statistics::stats_weekly_task_velocity,
            commands::statistics::task_year_range,
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
            commands::pattern::pattern_increment_usage,
            commands::learning::learn_record,
            commands::learning::learn_record_batch,
            commands::learning::learn_suggest,
            commands::learning::learn_stats,
            commands::learning::learn_known_keywords,
            commands::learning::history_suggest,
            commands::learning::history_get_template,
            commands::learning::feedback_record,
            commands::learning::feedback_rejected_titles,
            commands::learning::cluster_list,
            commands::learning::cluster_upsert,
            commands::learning::cluster_delete,
            commands::prediction::record_task_creation,
            commands::prediction::refresh_predictions,
            commands::prediction::get_pending_predictions,
            commands::prediction::update_prediction_status,
            commands::prediction::get_prediction_stats,
            commands::prediction::get_recent_notification_keys,
            commands::suggestion_trace::suggestion_run_create,
            commands::suggestion_trace::suggestion_candidate_insert,
            commands::suggestion_trace::suggestion_candidate_mark_selected,
            commands::suggestion_trace::suggestion_candidate_mark_rejected,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build tauri app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                // Debug builds: always exit so the Tauri CLI cleans up the Vite
                // dev server. Release builds: stay alive only when closeToTray
                // is enabled.
                if code.is_none() && !cfg!(debug_assertions) && read_close_to_tray(app_handle) {
                    api.prevent_exit();
                }
            }
        });
}
