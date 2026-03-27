use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::State;

use crate::db::AppState;

// ── Fuzzy matching utilities ────────────────────────────────────────

/// Character-level Jaccard similarity between two strings.
/// Returns 0.0-1.0. Used to match "四六级" ≈ "四级" (Jaccard = 0.67).
fn char_jaccard(a: &str, b: &str) -> f64 {
  if a == b {
    return 1.0;
  }
  let set_a: HashSet<char> = a.chars().collect();
  let set_b: HashSet<char> = b.chars().collect();
  let intersection = set_a.intersection(&set_b).count();
  let union = set_a.union(&set_b).count();
  if union == 0 {
    return 0.0;
  }
  intersection as f64 / union as f64
}

const JACCARD_THRESHOLD: f64 = 0.5;

/// Expand query keywords by finding fuzzy matches in the database.
/// Returns the union of original keywords + similar stored keywords.
fn expand_keywords_fuzzy(
  db: &rusqlite::Connection,
  keywords: &[String],
) -> Vec<String> {
  // Get all distinct keywords from learn_log
  let stored: Vec<String> = {
    let mut stmt = match db.prepare("SELECT DISTINCT keyword FROM subtask_learn_log WHERE score > 0") {
      Ok(s) => s,
      Err(_) => return keywords.to_vec(),
    };
    let rows = match stmt.query_map([], |row| row.get::<_, String>(0)) {
      Ok(r) => r,
      Err(_) => return keywords.to_vec(),
    };
    rows.filter_map(|r| r.ok()).collect()
  };

  let mut expanded: HashSet<String> = keywords.iter().cloned().collect();

  for query_kw in keywords {
    for stored_kw in &stored {
      if expanded.contains(stored_kw) {
        continue;
      }
      // Check containment (one contains the other)
      if stored_kw.contains(query_kw.as_str()) || query_kw.contains(stored_kw.as_str()) {
        expanded.insert(stored_kw.clone());
        continue;
      }
      // Check character Jaccard similarity
      if char_jaccard(query_kw, stored_kw) >= JACCARD_THRESHOLD {
        expanded.insert(stored_kw.clone());
      }
    }
  }

  expanded.into_iter().collect()
}

// ── Learn log types ─────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnLogRow {
  pub id: i64,
  pub cluster_id: Option<i64>,
  pub project_id: Option<i64>,
  pub keyword: String,
  pub subtask_title: String,
  pub score: i64,
  pub source: String,
  pub last_used_at: String,
  pub created_at: String,
}

// ── Cluster types ───────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeywordClusterRow {
  pub id: i64,
  pub name: String,
  pub keywords: Vec<String>,
  pub confirmed: i64,
  pub created_at: String,
  pub updated_at: String,
}

// ── Learn commands ──────────────────────────────────────────────────

/// Record a learn event (adopt/reject). Upserts by keyword+subtask_title+project_id.
#[tauri::command]
pub fn learn_record(
  state: State<'_, AppState>,
  keyword: String,
  subtask_title: String,
  project_id: Option<i64>,
  delta: i64,
  source: Option<String>,
) -> Result<(), String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let src = source.unwrap_or_else(|| "user".to_string());

  // Try to find existing record
  let existing_id: Option<i64> = db
    .query_row(
      "SELECT id FROM subtask_learn_log
       WHERE keyword = ?1 AND subtask_title = ?2 AND (project_id IS ?3)",
      rusqlite::params![keyword, subtask_title, project_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  if let Some(id) = existing_id {
    db.execute(
      "UPDATE subtask_learn_log SET score = score + ?2, last_used_at = CURRENT_TIMESTAMP WHERE id = ?1",
      rusqlite::params![id, delta],
    )
    .map_err(|e| e.to_string())?;
  } else {
    db.execute(
      "INSERT INTO subtask_learn_log (keyword, subtask_title, project_id, score, source)
       VALUES (?1, ?2, ?3, ?4, ?5)",
      rusqlite::params![keyword, subtask_title, project_id, delta, src],
    )
    .map_err(|e| e.to_string())?;
  }

  Ok(())
}

/// Batch record learn events for multiple keywords at once.
#[tauri::command]
pub fn learn_record_batch(
  state: State<'_, AppState>,
  keywords: Vec<String>,
  subtask_title: String,
  project_id: Option<i64>,
  delta: i64,
  source: Option<String>,
) -> Result<(), String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let src = source.unwrap_or_else(|| "user".to_string());

  // Batch query: find all existing keywords in one go
  let placeholders: String = keywords.iter().map(|_| "?").collect::<Vec<_>>().join(",");
  let sql = format!(
    "SELECT keyword FROM subtask_learn_log
     WHERE subtask_title = ?1 AND (project_id IS ?2) AND keyword IN ({})",
    placeholders
  );
  let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
  let mut params: Vec<&dyn rusqlite::ToSql> = vec![&subtask_title, &project_id];
  params.extend(keywords.iter().map(|k| k as &dyn rusqlite::ToSql));

  let existing_keywords: std::collections::HashSet<String> = stmt
    .query_map(params.as_slice(), |row| row.get(0))
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  // Batch update existing ones
  let mut update_stmt = db
    .prepare(
      "UPDATE subtask_learn_log SET score = score + ?3, last_used_at = CURRENT_TIMESTAMP
       WHERE keyword = ?1 AND subtask_title = ?2 AND project_id IS ?3",
    )
    .map_err(|e| e.to_string())?;

  for keyword in &keywords {
    if existing_keywords.contains(keyword) {
      update_stmt
        .execute(rusqlite::params![keyword, subtask_title, project_id, delta])
        .map_err(|e| e.to_string())?;
    }
  }

  // Batch insert new ones
  let mut insert_stmt = db
    .prepare(
      "INSERT INTO subtask_learn_log (keyword, subtask_title, project_id, score, source)
       VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .map_err(|e| e.to_string())?;

  for keyword in &keywords {
    if !existing_keywords.contains(keyword) {
      insert_stmt
        .execute(rusqlite::params![keyword, subtask_title, project_id, delta, src])
        .map_err(|e| e.to_string())?;
    }
  }

  Ok(())
}

/// Suggest subtasks based on keywords and project_id, ordered by score.
/// Uses fuzzy keyword expansion (character Jaccard + containment) to match
/// similar keywords like "四六级" ≈ "四级" ≈ "六级".
#[tauri::command]
pub fn learn_suggest(
  state: State<'_, AppState>,
  keywords: Vec<String>,
  project_id: Option<i64>,
  limit: Option<i64>,
) -> Result<Vec<LearnSuggestion>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let max_results = limit.unwrap_or(8);

  // Expand keywords via: 1) clusters, 2) fuzzy matching (Jaccard + containment)
  let mut expanded_keywords = keywords.clone();

  // Cluster expansion
  for kw in &keywords {
    let mut stmt = db
      .prepare(
        "SELECT keywords FROM keyword_clusters WHERE keywords LIKE ?1",
      )
      .map_err(|e| e.to_string())?;

    let pattern = format!("%\"{}%", kw);
    let rows = stmt
      .query_map(rusqlite::params![pattern], |row| {
        let json_str: String = row.get(0)?;
        Ok(json_str)
      })
      .map_err(|e| e.to_string())?;

    for row in rows {
      if let Ok(json_str) = row {
        if let Ok(cluster_kws) = serde_json::from_str::<Vec<String>>(&json_str) {
          for ckw in cluster_kws {
            if !expanded_keywords.contains(&ckw) {
              expanded_keywords.push(ckw);
            }
          }
        }
      }
    }
  }

  // Fuzzy expansion: character Jaccard + containment
  let fuzzy_expanded = expand_keywords_fuzzy(&db, &expanded_keywords);
  expanded_keywords = fuzzy_expanded;

  // Query learn log for all expanded keywords
  if expanded_keywords.is_empty() {
    return Ok(vec![]);
  }

  let placeholders: Vec<String> = expanded_keywords
    .iter()
    .enumerate()
    .map(|(i, _)| format!("?{}", i + 1))
    .collect();

  let project_param_idx = expanded_keywords.len() + 1;
  let limit_param_idx = expanded_keywords.len() + 2;

  let sql = format!(
    "SELECT subtask_title, SUM(score) as total_score, MAX(last_used_at) as last_used
     FROM subtask_learn_log
     WHERE keyword IN ({})
       AND (project_id IS NULL OR project_id = ?{})
       AND score > 0
     GROUP BY subtask_title
     HAVING total_score > 0
     ORDER BY total_score DESC, last_used DESC
     LIMIT ?{}",
    placeholders.join(","),
    project_param_idx,
    limit_param_idx
  );

  let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;

  let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
  for kw in &expanded_keywords {
    params.push(Box::new(kw.clone()));
  }
  params.push(Box::new(project_id));
  params.push(Box::new(max_results));

  let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

  let rows = stmt
    .query_map(param_refs.as_slice(), |row| {
      Ok(LearnSuggestion {
        title: row.get(0)?,
        score: row.get(1)?,
        last_used_at: row.get(2)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut result = Vec::new();
  for row in rows {
    result.push(row.map_err(|e| e.to_string())?);
  }
  Ok(result)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnSuggestion {
  pub title: String,
  pub score: i64,
  pub last_used_at: String,
}

// ── Cluster commands ────────────────────────────────────────────────

fn read_cluster_row(row: &rusqlite::Row) -> rusqlite::Result<KeywordClusterRow> {
  let keywords_json: String = row.get(2)?;
  Ok(KeywordClusterRow {
    id: row.get(0)?,
    name: row.get(1)?,
    keywords: serde_json::from_str(&keywords_json).unwrap_or_default(),
    confirmed: row.get(3)?,
    created_at: row.get(4)?,
    updated_at: row.get(5)?,
  })
}

#[tauri::command]
pub fn cluster_list(state: State<'_, AppState>) -> Result<Vec<KeywordClusterRow>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let mut stmt = db
    .prepare(
      "SELECT id, name, keywords, confirmed, created_at, updated_at
       FROM keyword_clusters
       ORDER BY confirmed DESC, id ASC",
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map([], |row| read_cluster_row(row))
    .map_err(|e| e.to_string())?;

  let mut result = Vec::new();
  for row in rows {
    result.push(row.map_err(|e| e.to_string())?);
  }
  Ok(result)
}

#[tauri::command]
pub fn cluster_upsert(
  state: State<'_, AppState>,
  id: Option<i64>,
  name: String,
  keywords: Vec<String>,
  confirmed: Option<i64>,
) -> Result<KeywordClusterRow, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let keywords_json = serde_json::to_string(&keywords).map_err(|e| e.to_string())?;
  let confirmed_val = confirmed.unwrap_or(0);

  let row_id = if let Some(existing_id) = id {
    db.execute(
      "UPDATE keyword_clusters SET name = ?2, keywords = ?3, confirmed = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
      rusqlite::params![existing_id, name, keywords_json, confirmed_val],
    )
    .map_err(|e| e.to_string())?;
    existing_id
  } else {
    db.execute(
      "INSERT INTO keyword_clusters (name, keywords, confirmed) VALUES (?1, ?2, ?3)",
      rusqlite::params![name, keywords_json, confirmed_val],
    )
    .map_err(|e| e.to_string())?;
    db.last_insert_rowid()
  };

  db.query_row(
    "SELECT id, name, keywords, confirmed, created_at, updated_at
     FROM keyword_clusters WHERE id = ?1",
    rusqlite::params![row_id],
    |row| read_cluster_row(row),
  )
  .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cluster_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  db.execute(
    "DELETE FROM keyword_clusters WHERE id = ?1",
    rusqlite::params![id],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

// ── Learn stats ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnStats {
  pub match_count: i64,
  pub max_score: i64,
  pub total_feedback: i64,
  pub history_count: i64,
}

/// Get aggregate learn stats for keywords, used for confidence scoring.
/// Uses fuzzy keyword expansion for broader matching.
#[tauri::command]
pub fn learn_stats(
  state: State<'_, AppState>,
  keywords: Vec<String>,
  project_id: Option<i64>,
) -> Result<LearnStats, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  if keywords.is_empty() {
    return Ok(LearnStats {
      match_count: 0,
      max_score: 0,
      total_feedback: 0,
      history_count: 0,
    });
  }

  // Fuzzy expand keywords
  let expanded = expand_keywords_fuzzy(&db, &keywords);

  let placeholders: Vec<String> = expanded
    .iter()
    .enumerate()
    .map(|(i, _)| format!("?{}", i + 1))
    .collect();
  let project_idx = expanded.len() + 1;

  // Count distinct subtask_titles with positive score
  let sql = format!(
    "SELECT
       COUNT(DISTINCT subtask_title) as match_count,
       COALESCE(MAX(score), 0) as max_score,
       COUNT(*) as total_feedback
     FROM subtask_learn_log
     WHERE keyword IN ({})
       AND (project_id IS NULL OR project_id = ?{})
       AND score > 0",
    placeholders.join(","),
    project_idx
  );

  let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
  for kw in &expanded {
    params.push(Box::new(kw.clone()));
  }
  params.push(Box::new(project_id));
  let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

  let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
  let (match_count, max_score, total_feedback) = stmt
    .query_row(param_refs.as_slice(), |row| {
      Ok((
        row.get::<_, i64>(0)?,
        row.get::<_, i64>(1)?,
        row.get::<_, i64>(2)?,
      ))
    })
    .map_err(|e| e.to_string())?;

  // Count matching task_subtask_history entries (use original keywords for title LIKE)
  let history_sql = format!(
    "SELECT COUNT(*) FROM task_subtask_history
     WHERE ({})
       AND (project_id IS NULL OR project_id = ?{})",
    expanded
      .iter()
      .enumerate()
      .map(|(i, _)| format!("parent_title LIKE ?{}", i + 1))
      .collect::<Vec<_>>()
      .join(" OR "),
    project_idx
  );

  let mut h_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
  for kw in &expanded {
    h_params.push(Box::new(format!("%{}%", kw)));
  }
  h_params.push(Box::new(project_id));
  let h_refs: Vec<&dyn rusqlite::types::ToSql> = h_params.iter().map(|p| p.as_ref()).collect();

  let mut h_stmt = db.prepare(&history_sql).map_err(|e| e.to_string())?;
  let history_count: i64 = h_stmt
    .query_row(h_refs.as_slice(), |row| row.get(0))
    .map_err(|e| e.to_string())?;

  Ok(LearnStats {
    match_count,
    max_score,
    total_feedback,
    history_count,
  })
}

/// Return all known keywords (score > 0) for the keyword cache.
#[tauri::command]
pub fn learn_known_keywords(state: State<'_, AppState>) -> Result<Vec<String>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let mut stmt = db
    .prepare("SELECT DISTINCT keyword FROM subtask_learn_log WHERE score > 0")
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map([], |row| row.get::<_, String>(0))
    .map_err(|e| e.to_string())?;

  let mut result = Vec::new();
  for row in rows {
    result.push(row.map_err(|e| e.to_string())?);
  }
  Ok(result)
}

/// Suggest subtasks from task_subtask_history based on keyword matching.
#[tauri::command]
pub fn history_suggest(
  state: State<'_, AppState>,
  keywords: Vec<String>,
  project_id: Option<i64>,
  limit: Option<i64>,
) -> Result<Vec<String>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let max_results = limit.unwrap_or(8);

  if keywords.is_empty() {
    return Ok(vec![]);
  }

  let project_idx = keywords.len() + 1;
  let limit_idx = keywords.len() + 2;

  // Find history entries where parent_title contains any keyword
  let where_clause: Vec<String> = keywords
    .iter()
    .enumerate()
    .map(|(i, _)| format!("parent_title LIKE ?{}", i + 1))
    .collect();

  let sql = format!(
    "SELECT subtask_titles FROM task_subtask_history
     WHERE ({})
       AND (project_id IS NULL OR project_id = ?{})
     ORDER BY captured_at DESC
     LIMIT ?{}",
    where_clause.join(" OR "),
    project_idx,
    limit_idx
  );

  let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
  for kw in &keywords {
    params.push(Box::new(format!("%{}%", kw)));
  }
  params.push(Box::new(project_id));
  params.push(Box::new(max_results));
  let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

  let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map(param_refs.as_slice(), |row| row.get::<_, String>(0))
    .map_err(|e| e.to_string())?;

  // Collect and deduplicate subtask titles across all matching history entries
  let mut seen = std::collections::HashSet::new();
  let mut result = Vec::new();
  for row in rows {
    let json_str = row.map_err(|e| e.to_string())?;
    if let Ok(titles) = serde_json::from_str::<Vec<String>>(&json_str) {
      for title in titles {
        if seen.insert(title.clone()) {
          result.push(title);
        }
      }
    }
  }

  result.truncate(max_results as usize);
  Ok(result)
}

// ── Suggestion feedback commands ────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRecordPayload {
  pub task_id: i64,
  pub task_title: String,
  pub project_id: Option<i64>,
  pub suggestion_title: String,
  pub source: String,
  pub action: String,
  pub job_id: Option<i64>,
}

#[tauri::command]
pub fn feedback_record(
  state: State<'_, AppState>,
  payload: FeedbackRecordPayload,
) -> Result<(), String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  db.execute(
    "INSERT INTO suggestion_feedback (task_id, task_title, project_id, suggestion_title, source, action, job_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    rusqlite::params![
      payload.task_id,
      payload.task_title,
      payload.project_id,
      payload.suggestion_title,
      payload.source,
      payload.action,
      payload.job_id,
    ],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

/// Get rejected suggestion titles for keywords, used to tell AI what to avoid.
#[tauri::command]
pub fn feedback_rejected_titles(
  state: State<'_, AppState>,
  keywords: Vec<String>,
  project_id: Option<i64>,
) -> Result<Vec<String>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  if keywords.is_empty() {
    return Ok(vec![]);
  }

  let project_idx = keywords.len() + 1;
  let where_clause: Vec<String> = keywords
    .iter()
    .enumerate()
    .map(|(i, _)| format!("task_title LIKE ?{}", i + 1))
    .collect();

  let sql = format!(
    "SELECT DISTINCT suggestion_title FROM suggestion_feedback
     WHERE action = 'rejected'
       AND ({})
       AND (project_id IS NULL OR project_id = ?{})
     ORDER BY created_at DESC
     LIMIT 20",
    where_clause.join(" OR "),
    project_idx
  );

  let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
  for kw in &keywords {
    params.push(Box::new(format!("%{}%", kw)));
  }
  params.push(Box::new(project_id));
  let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

  let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map(param_refs.as_slice(), |row| row.get::<_, String>(0))
    .map_err(|e| e.to_string())?;

  let mut result = Vec::new();
  for row in rows {
    result.push(row.map_err(|e| e.to_string())?);
  }
  Ok(result)
}
