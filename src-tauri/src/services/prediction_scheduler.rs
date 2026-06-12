use crate::db::AppState;
use crate::services::prediction_engine::{refresh_predictions as refresh_predictions_internal, RefreshOutcome};
use rusqlite::params;
use tauri::{AppHandle, Emitter, Manager};

const ANALYSIS_INTERVAL_HOURS: u64 = 1;

/// Emit event to frontend after local prediction refresh.
/// `new_ids` identifies the rows inserted this round — the frontend
/// notifies exactly those instead of guessing from a count.
fn emit_prediction_update(app: &AppHandle, outcome: &RefreshOutcome) {
    let payload = serde_json::json!({
        "createdCount": outcome.new_ids.len(),
        "createdIds": outcome.new_ids,
        "triggeredAt": chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string(),
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
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async {
            let mut interval = tokio::time::interval(
                tokio::time::Duration::from_secs(ANALYSIS_INTERVAL_HOURS * 3600),
            );

            // Delay all work until app_init has finished — avoids db lock contention
            // that would block the frontend during startup.
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;

            // Initial cleanup
            if let Some(state) = app.try_state::<AppState>() {
                let db = state.db();
                if let Ok(conn) = db.lock() {
                    let _ = cleanup_old_predictions(&conn);
                }
            }

            loop {
                interval.tick().await;

                if let Some(state) = app.try_state::<AppState>() {
                    let db = state.db();
                    if let Ok(conn) = db.lock() {
                        // Cleanup old predictions first
                        let _ = cleanup_old_predictions(&conn);

                        // The engine itself enforces the 1h throttle and the
                        // minimum-history requirement.
                        let now = chrono::Local::now();
                        match refresh_predictions_internal(&conn, now, false) {
                            Ok(outcome) if outcome.changed => {
                                emit_prediction_update(&app, &outcome);
                                println!(
                                    "[prediction_scheduler] Refreshed predictions: {} new, {} live",
                                    outcome.new_ids.len(),
                                    outcome.predictions.len()
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
                    }
                }
            }
        });
    });

    println!("[prediction_scheduler] Started");
}
