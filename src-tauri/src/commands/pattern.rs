use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternRow {
  pub id: i64,
  pub name: String,
  pub keywords: Vec<String>,
  pub subtasks: Vec<String>,
  pub project_id: Option<i64>,
  pub is_builtin: bool,
  pub usage_count: i64,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternCreatePayload {
  pub name: String,
  pub keywords: Vec<String>,
  pub subtasks: Vec<String>,
  pub project_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternUpdatePayload {
  pub name: Option<String>,
  pub keywords: Option<Vec<String>>,
  pub subtasks: Option<Vec<String>>,
  pub project_id: Option<i64>,
}

fn read_pattern_row(row: &rusqlite::Row) -> rusqlite::Result<PatternRow> {
  let keywords_json: String = row.get(2)?;
  let subtasks_json: String = row.get(3)?;
  let is_builtin_int: i64 = row.get(5)?;

  Ok(PatternRow {
    id: row.get(0)?,
    name: row.get(1)?,
    keywords: serde_json::from_str(&keywords_json).unwrap_or_default(),
    subtasks: serde_json::from_str(&subtasks_json).unwrap_or_default(),
    project_id: row.get(4)?,
    is_builtin: is_builtin_int != 0,
    usage_count: row.get(6)?,
    created_at: row.get(7)?,
    updated_at: row.get(8)?,
  })
}

#[tauri::command]
pub fn pattern_list(
  state: State<'_, AppState>,
  project_id: Option<i64>,
) -> Result<Vec<PatternRow>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(pid) = project_id
  {
    (
      "SELECT id, name, keywords, subtasks, project_id, is_builtin, usage_count, created_at, updated_at
       FROM subtask_patterns
       WHERE project_id IS NULL OR project_id = ?1
       ORDER BY usage_count DESC, id ASC"
        .to_string(),
      vec![Box::new(pid) as Box<dyn rusqlite::types::ToSql>],
    )
  } else {
    (
      "SELECT id, name, keywords, subtasks, project_id, is_builtin, usage_count, created_at, updated_at
       FROM subtask_patterns
       ORDER BY usage_count DESC, id ASC"
        .to_string(),
      vec![],
    )
  };

  let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
  let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

  let rows = stmt
    .query_map(param_refs.as_slice(), |row| read_pattern_row(row))
    .map_err(|e| e.to_string())?;

  let mut result = Vec::new();
  for row in rows {
    result.push(row.map_err(|e| e.to_string())?);
  }
  Ok(result)
}

#[tauri::command]
pub fn pattern_create(
  state: State<'_, AppState>,
  payload: PatternCreatePayload,
) -> Result<PatternRow, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let keywords_json = serde_json::to_string(&payload.keywords).map_err(|e| e.to_string())?;
  let subtasks_json = serde_json::to_string(&payload.subtasks).map_err(|e| e.to_string())?;

  db.execute(
    "INSERT INTO subtask_patterns (name, keywords, subtasks, project_id, is_builtin)
     VALUES (?1, ?2, ?3, ?4, 0)",
    rusqlite::params![payload.name, keywords_json, subtasks_json, payload.project_id],
  )
  .map_err(|e| e.to_string())?;

  let id = db.last_insert_rowid();
  db.query_row(
    "SELECT id, name, keywords, subtasks, project_id, is_builtin, usage_count, created_at, updated_at
     FROM subtask_patterns WHERE id = ?1",
    rusqlite::params![id],
    |row| read_pattern_row(row),
  )
  .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pattern_update(
  state: State<'_, AppState>,
  id: i64,
  payload: PatternUpdatePayload,
) -> Result<(), String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  let mut sets = Vec::new();
  let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

  if let Some(ref name) = payload.name {
    sets.push("name = ?");
    params.push(Box::new(name.clone()));
  }
  if let Some(ref keywords) = payload.keywords {
    let json = serde_json::to_string(keywords).map_err(|e| e.to_string())?;
    sets.push("keywords = ?");
    params.push(Box::new(json));
  }
  if let Some(ref subtasks) = payload.subtasks {
    let json = serde_json::to_string(subtasks).map_err(|e| e.to_string())?;
    sets.push("subtasks = ?");
    params.push(Box::new(json));
  }
  if payload.project_id.is_some() {
    sets.push("project_id = ?");
    params.push(Box::new(payload.project_id));
  }

  if sets.is_empty() {
    return Ok(());
  }

  sets.push("updated_at = CURRENT_TIMESTAMP");
  params.push(Box::new(id));

  let sql = format!(
    "UPDATE subtask_patterns SET {} WHERE id = ?",
    sets.join(", ")
  );
  let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

  db.execute(&sql, param_refs.as_slice())
    .map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
pub fn pattern_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  db.execute(
    "DELETE FROM subtask_patterns WHERE id = ?1",
    rusqlite::params![id],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn pattern_match(
  state: State<'_, AppState>,
  keywords: Vec<String>,
  project_id: Option<i64>,
) -> Result<Vec<PatternRow>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  // Load all patterns (project-specific + global)
  let mut stmt = db
    .prepare(
      "SELECT id, name, keywords, subtasks, project_id, is_builtin, usage_count, created_at, updated_at
       FROM subtask_patterns
       ORDER BY usage_count DESC, id ASC",
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map([], |row| read_pattern_row(row))
    .map_err(|e| e.to_string())?;

  let all_patterns: Vec<PatternRow> = rows
    .filter_map(|r| r.ok())
    .collect();

  let input_lower: Vec<String> = keywords.iter().map(|k| k.to_lowercase()).collect();

  let mut matched: Vec<PatternRow> = all_patterns
    .into_iter()
    .filter(|p| {
      let pattern_keywords: Vec<String> = p.keywords.iter().map(|k| k.to_lowercase()).collect();
      // Check if any input keyword matches any pattern keyword (substring match)
      input_lower.iter().any(|ik| {
        pattern_keywords
          .iter()
          .any(|pk| ik.contains(pk.as_str()) || pk.contains(ik.as_str()))
      })
    })
    .collect();

  // Prioritize project-specific patterns
  if let Some(pid) = project_id {
    matched.sort_by(|a, b| {
      let a_match = a.project_id == Some(pid);
      let b_match = b.project_id == Some(pid);
      b_match.cmp(&a_match).then(b.usage_count.cmp(&a.usage_count))
    });
  }

  // Increment usage_count for matched patterns
  for p in &matched {
    let _ = db.execute(
      "UPDATE subtask_patterns SET usage_count = usage_count + 1 WHERE id = ?1",
      rusqlite::params![p.id],
    );
  }

  Ok(matched)
}
