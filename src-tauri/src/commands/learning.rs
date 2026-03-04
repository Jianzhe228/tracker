use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::AppState;

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

  for keyword in &keywords {
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
  }

  Ok(())
}

/// Suggest subtasks based on keywords and project_id, ordered by score.
#[tauri::command]
pub fn learn_suggest(
  state: State<'_, AppState>,
  keywords: Vec<String>,
  project_id: Option<i64>,
  limit: Option<i64>,
) -> Result<Vec<LearnSuggestion>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let max_results = limit.unwrap_or(8);

  // First, expand keywords via clusters
  let mut expanded_keywords = keywords.clone();
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
