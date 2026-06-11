//! Suggestion trace persistence commands for the Phase 1 harness.
//!
//! Tables: suggestion_runs, suggestion_candidates
//! These tables are append-only audit logs — no updates except marking selected/rejected.

use tauri::State;

use crate::db::AppState;

/// Create a new suggestion run and return its id.
#[tauri::command]
pub fn suggestion_run_create(
    state: State<'_, AppState>,
    task_id: i64,
    task_title: String,
    project_id: Option<i64>,
    analysis_json: String,
    strategy: String,
) -> Result<i64, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO suggestion_runs (task_id, task_title, project_id, analysis_json, strategy)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![task_id, task_title, project_id, analysis_json, strategy],
    )
    .map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

/// Insert a candidate into an existing run.
#[tauri::command]
pub fn suggestion_candidate_insert(
    state: State<'_, AppState>,
    run_id: i64,
    title: String,
    source: String,
    merged_sources_json: String,
    score: f64,
    evidence_json: String,
    reasons_json: String,
    shown_rank: Option<i64>,
) -> Result<i64, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO suggestion_candidates
         (run_id, title, source, merged_sources_json, score, evidence_json, reasons_json, shown_rank)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            run_id,
            title,
            source,
            merged_sources_json,
            score,
            evidence_json,
            reasons_json,
            shown_rank,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

/// Mark a candidate as selected (accepted by user).
#[tauri::command]
pub fn suggestion_candidate_mark_selected(
    state: State<'_, AppState>,
    candidate_id: i64,
) -> Result<(), String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE suggestion_candidates SET selected = 1 WHERE id = ?1",
        rusqlite::params![candidate_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Mark a candidate as rejected by user.
#[tauri::command]
pub fn suggestion_candidate_mark_rejected(
    state: State<'_, AppState>,
    candidate_id: i64,
) -> Result<(), String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE suggestion_candidates SET rejected = 1 WHERE id = ?1",
        rusqlite::params![candidate_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
