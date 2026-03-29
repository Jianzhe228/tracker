use crate::db::AppState;
use crate::services::prediction_engine::{
    refresh_predictions as refresh_predictions_internal, should_refresh_predictions,
    MIN_HISTORY_FOR_PREDICTION,
};
use rusqlite::params;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

const ANALYSIS_INTERVAL_HOURS: u64 = 1;

/// Get count of task creation history
fn get_history_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM task_creation_history WHERE is_recurring_instance = 0",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

/// Emit event to frontend after local prediction refresh.
fn emit_prediction_update(app: &AppHandle, created_count: usize) {
    let payload = serde_json::json!({
        "createdCount": created_count,
        "triggeredAt": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    });

    if let Err(e) = app.emit("prediction:updated", payload) {
        eprintln!("[prediction_scheduler] Failed to emit update event: {}", e);
    }
}

/// Mark existing pending predictions as expired if they're old
pub fn cleanup_old_predictions(conn: &rusqlite::Connection) -> Result<(), String> {
    let cutoff = chrono::Local::now()
        .checked_sub_signed(chrono::Duration::days(7))
        .ok_or("Invalid date calculation")?
        .format("%Y-%m-%d")
        .to_string();

    conn.execute(
        "UPDATE pending_predictions SET status = 'expired'
         WHERE status IN ('pending', 'notified')
           AND predicted_for_date < ?1",
        params![cutoff],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Start the prediction scheduler background task
pub fn start_scheduler(app: AppHandle) {
    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async {
            let mut interval = tokio::time::interval(
                tokio::time::Duration::from_secs(ANALYSIS_INTERVAL_HOURS * 3600),
            );

            // Initial cleanup
            if let Some(state) = app.try_state::<AppState>() {
                let db = state.db();
                if let Ok(conn) = db.lock() {
                    let _ = cleanup_old_predictions(&conn);
                }
            }

            // Wait a bit after startup before first check
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;

            while running_clone.load(Ordering::SeqCst) {
                interval.tick().await;

                if !running_clone.load(Ordering::SeqCst) {
                    break;
                }

                if let Some(state) = app.try_state::<AppState>() {
                    let db = state.db();
                    if let Ok(conn) = db.lock() {
                        // Cleanup old predictions first
                        let _ = cleanup_old_predictions(&conn);

                        let now = chrono::Local::now();
                        if should_refresh_predictions(&conn, now).unwrap_or(true) {
                            let history_count = get_history_count(&conn);
                            if history_count >= MIN_HISTORY_FOR_PREDICTION as i64 {
                                match refresh_predictions_internal(&conn, now, false) {
                                    Ok(created) if !created.is_empty() => {
                                        emit_prediction_update(&app, created.len());
                                        println!(
                                            "[prediction_scheduler] Generated {} predictions from {} history entries",
                                            created.len(),
                                            history_count
                                        );
                                    }
                                    Ok(_) => {}
                                    Err(error) => {
                                        eprintln!(
                                            "[prediction_scheduler] Failed to refresh predictions: {}",
                                            error
                                        );
                                    }
                                }
                            } else {
                                println!(
                                    "[prediction_scheduler] Skipping - only {} history entries (min: {})",
                                    history_count, MIN_HISTORY_FOR_PREDICTION
                                );
                            }
                        }
                    }
                }
            }
        });
    });

    println!("[prediction_scheduler] Started");
}

/// Stop the scheduler
pub fn stop_scheduler() {
    // The scheduler will stop on next tick check
}
