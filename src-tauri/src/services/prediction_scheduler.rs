use crate::db::AppState;
use rusqlite::params;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

const ANALYSIS_INTERVAL_HOURS: u64 = 1;
const MIN_HISTORY_FOR_ANALYSIS: i64 = 7;

/// Check if enough time has passed since last analysis
fn should_run_analysis(conn: &rusqlite::Connection) -> bool {
    // Get the most recent prediction created time
    let result: Result<Option<String>, _> = conn.query_row(
        "SELECT MAX(created_at) FROM pending_predictions WHERE source_job_id IS NOT NULL",
        [],
        |row| row.get(0),
    );

    match result {
        Ok(Some(last_run)) => {
            // Parse the timestamp and check if 1 hour has passed
            if let Ok(last_dt) = chrono::DateTime::parse_from_rfc3339(&last_run) {
                let now = chrono::Utc::now();
                let diff = now.signed_duration_since(last_dt);
                diff.num_hours() >= ANALYSIS_INTERVAL_HOURS as i64
            } else {
                true // Invalid timestamp, should run
            }
        }
        Ok(None) => true, // No previous analysis, should run
        Err(_) => true,   // Error, should run
    }
}

/// Get count of task creation history
fn get_history_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM task_creation_history WHERE is_recurring_instance = 0",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

/// Emit event to frontend to trigger AI analysis
fn emit_analysis_trigger(app: &AppHandle, history_count: i64) {
    let payload = serde_json::json!({
        "historyCount": history_count,
        "triggeredAt": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    });

    if let Err(e) = app.emit("prediction:trigger-analysis", payload) {
        eprintln!("[prediction_scheduler] Failed to emit trigger event: {}", e);
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

                        // Check if we should run analysis
                        if should_run_analysis(&conn) {
                            let history_count = get_history_count(&conn);
                            if history_count >= MIN_HISTORY_FOR_ANALYSIS {
                                emit_analysis_trigger(&app, history_count);
                                println!(
                                    "[prediction_scheduler] Triggered analysis with {} history entries",
                                    history_count
                                );
                            } else {
                                println!(
                                    "[prediction_scheduler] Skipping - only {} history entries (min: {})",
                                    history_count, MIN_HISTORY_FOR_ANALYSIS
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
