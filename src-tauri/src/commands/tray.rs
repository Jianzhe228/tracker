use tauri::AppHandle;

/// Update the tray icon tooltip with the current timer state. The frontend
/// pushes minute-granularity text so this fires ~once per minute.
/// Some Linux tray backends don't support tooltips — callers treat errors
/// as non-fatal.
#[tauri::command]
pub fn set_tray_tooltip(app: AppHandle, tooltip: String) -> Result<(), String> {
    let tray = app
        .tray_by_id("main-tray")
        .ok_or_else(|| "tray not initialized".to_string())?;
    tray.set_tooltip(Some(tooltip.as_str()))
        .map_err(|e| e.to_string())
}
