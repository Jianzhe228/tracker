use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::AppState;

// ── Skill types ──────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSkillRow {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub user_prompt_template: String,
    pub action_types: Vec<String>,
    pub trigger_type: String,
    pub is_builtin: bool,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSkillCreatePayload {
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub user_prompt_template: String,
    pub action_types: Option<Vec<String>>,
    pub trigger_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSkillUpdatePayload {
    pub name: Option<String>,
    pub description: Option<String>,
    pub system_prompt: Option<String>,
    pub user_prompt_template: Option<String>,
    pub action_types: Option<Vec<String>>,
    pub trigger_type: Option<String>,
}

// ── Job types ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiJobRow {
    pub id: i64,
    pub skill_id: i64,
    pub status: String,
    pub input_context: serde_json::Value,
    pub raw_response: Option<String>,
    pub actions: Option<serde_json::Value>,
    pub error: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

// ── Helper to read a skill row ───────────────────────────────────────

fn read_skill_row(row: &rusqlite::Row) -> rusqlite::Result<AiSkillRow> {
    let action_types_json: String = row.get(5)?;
    let action_types: Vec<String> = serde_json::from_str(&action_types_json).unwrap_or_default();
    let is_builtin_int: i64 = row.get(8)?;
    let enabled_int: i64 = row.get(9)?;

    Ok(AiSkillRow {
        id: row.get(0)?,
        key: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        system_prompt: row.get(4)?,
        user_prompt_template: row.get(6)?,
        action_types,
        trigger_type: row.get(7)?,
        is_builtin: is_builtin_int != 0,
        enabled: enabled_int != 0,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn read_job_row(row: &rusqlite::Row) -> rusqlite::Result<AiJobRow> {
    let input_context_str: String = row.get(3)?;
    let input_context: serde_json::Value = serde_json::from_str(&input_context_str)
        .unwrap_or(serde_json::Value::Object(Default::default()));
    let actions_str: Option<String> = row.get(5)?;
    let actions: Option<serde_json::Value> = actions_str
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    Ok(AiJobRow {
        id: row.get(0)?,
        skill_id: row.get(1)?,
        status: row.get(2)?,
        input_context,
        raw_response: row.get(4)?,
        actions,
        error: row.get(6)?,
        created_at: row.get(7)?,
        completed_at: row.get(8)?,
    })
}

// ── Skill commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn ai_skill_list(state: State<'_, AppState>) -> Result<Vec<AiSkillRow>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT id, key, name, description, system_prompt, action_types,
              user_prompt_template, trigger_type, is_builtin, enabled,
              created_at, updated_at
       FROM ai_skills
       ORDER BY is_builtin DESC, id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| read_skill_row(row))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn ai_skill_get(state: State<'_, AppState>, id: i64) -> Result<AiSkillRow, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    db.query_row(
        "SELECT id, key, name, description, system_prompt, action_types,
            user_prompt_template, trigger_type, is_builtin, enabled,
            created_at, updated_at
     FROM ai_skills WHERE id = ?1",
        rusqlite::params![id],
        |row| read_skill_row(row),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_skill_create(
    state: State<'_, AppState>,
    payload: AiSkillCreatePayload,
) -> Result<AiSkillRow, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let action_types_json = serde_json::to_string(&payload.action_types.unwrap_or_default())
        .map_err(|e| e.to_string())?;
    let trigger_type = payload.trigger_type.unwrap_or_else(|| "manual".to_string());
    let description = payload.description.unwrap_or_default();

    db.execute(
    "INSERT INTO ai_skills (key, name, description, system_prompt, user_prompt_template, action_types, trigger_type, is_builtin, enabled)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 1)",
    rusqlite::params![
      payload.key,
      payload.name,
      description,
      payload.system_prompt,
      payload.user_prompt_template,
      action_types_json,
      trigger_type,
    ],
  )
  .map_err(|e| e.to_string())?;

    let id = db.last_insert_rowid();

    db.query_row(
        "SELECT id, key, name, description, system_prompt, action_types,
            user_prompt_template, trigger_type, is_builtin, enabled,
            created_at, updated_at
     FROM ai_skills WHERE id = ?1",
        rusqlite::params![id],
        |row| read_skill_row(row),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_skill_update(
    state: State<'_, AppState>,
    id: i64,
    payload: AiSkillUpdatePayload,
) -> Result<(), String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let mut sets = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref name) = payload.name {
        sets.push("name = ?");
        params.push(Box::new(name.clone()));
    }
    if let Some(ref description) = payload.description {
        sets.push("description = ?");
        params.push(Box::new(description.clone()));
    }
    if let Some(ref system_prompt) = payload.system_prompt {
        sets.push("system_prompt = ?");
        params.push(Box::new(system_prompt.clone()));
    }
    if let Some(ref user_prompt_template) = payload.user_prompt_template {
        sets.push("user_prompt_template = ?");
        params.push(Box::new(user_prompt_template.clone()));
    }
    if let Some(ref action_types) = payload.action_types {
        let json = serde_json::to_string(action_types).map_err(|e| e.to_string())?;
        sets.push("action_types = ?");
        params.push(Box::new(json));
    }
    if let Some(ref trigger_type) = payload.trigger_type {
        sets.push("trigger_type = ?");
        params.push(Box::new(trigger_type.clone()));
    }

    if sets.is_empty() {
        return Ok(());
    }

    sets.push("updated_at = CURRENT_TIMESTAMP");
    params.push(Box::new(id));

    let sql = format!("UPDATE ai_skills SET {} WHERE id = ?", sets.join(", "));
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    db.execute(&sql, param_refs.as_slice())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn ai_skill_toggle(state: State<'_, AppState>, id: i64, enabled: bool) -> Result<(), String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE ai_skills SET enabled = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
        rusqlite::params![id, enabled as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Job commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn ai_job_create(
    state: State<'_, AppState>,
    skill_id: i64,
    input_context: String,
) -> Result<AiJobRow, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    // Verify skill exists
    let exists: bool = db
        .query_row(
            "SELECT COUNT(*) > 0 FROM ai_skills WHERE id = ?1",
            rusqlite::params![skill_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if !exists {
        return Err("Skill not found".to_string());
    }

    db.execute(
        "INSERT INTO ai_jobs (skill_id, status, input_context) VALUES (?1, 'pending', ?2)",
        rusqlite::params![skill_id, input_context],
    )
    .map_err(|e| e.to_string())?;

    let id = db.last_insert_rowid();

    db.query_row(
    "SELECT id, skill_id, status, input_context, raw_response, actions, error, created_at, completed_at
     FROM ai_jobs WHERE id = ?1",
    rusqlite::params![id],
    |row| read_job_row(row),
  )
  .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_job_update(
    state: State<'_, AppState>,
    id: i64,
    status: Option<String>,
    raw_response: Option<String>,
    actions: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let mut sets = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref status) = status {
        sets.push("status = ?");
        params.push(Box::new(status.clone()));
        if status == "completed" || status == "failed" {
            sets.push("completed_at = CURRENT_TIMESTAMP");
        }
    }
    if let Some(ref raw_response) = raw_response {
        sets.push("raw_response = ?");
        params.push(Box::new(raw_response.clone()));
    }
    if let Some(ref actions) = actions {
        sets.push("actions = ?");
        params.push(Box::new(actions.clone()));
    }
    if let Some(ref error) = error {
        sets.push("error = ?");
        params.push(Box::new(error.clone()));
    }

    if sets.is_empty() {
        return Ok(());
    }

    params.push(Box::new(id));
    let sql = format!("UPDATE ai_jobs SET {} WHERE id = ?", sets.join(", "));
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    db.execute(&sql, param_refs.as_slice())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn ai_job_list(
    state: State<'_, AppState>,
    status: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<AiJobRow>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let limit_val = limit.unwrap_or(50);

    let (sql, param_values): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(ref s) =
        status
    {
        (
      "SELECT id, skill_id, status, input_context, raw_response, actions, error, created_at, completed_at
       FROM ai_jobs WHERE status = ?1 ORDER BY created_at DESC LIMIT ?2".to_string(),
      vec![Box::new(s.clone()) as Box<dyn rusqlite::types::ToSql>, Box::new(limit_val)],
    )
    } else {
        (
      "SELECT id, skill_id, status, input_context, raw_response, actions, error, created_at, completed_at
       FROM ai_jobs ORDER BY created_at DESC LIMIT ?1".to_string(),
      vec![Box::new(limit_val) as Box<dyn rusqlite::types::ToSql>],
    )
    };

    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| read_job_row(row))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn ai_job_pending_actions(state: State<'_, AppState>) -> Result<Vec<AiJobRow>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let mut stmt = db
    .prepare(
      "SELECT id, skill_id, status, input_context, raw_response, actions, error, created_at, completed_at
       FROM ai_jobs
       WHERE status = 'completed'
         AND actions IS NOT NULL
         AND actions LIKE '%\"pending\"%'
       ORDER BY created_at DESC
       LIMIT 50",
    )
    .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| read_job_row(row))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}
