use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRow {
    pub id: i64,
    pub title: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub parent_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreatePayload {
    pub title: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub parent_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUpdatePayload {
    pub id: i64,
    pub title: Option<String>,
    pub color: Option<Option<String>>,
    pub icon: Option<Option<String>>,
    pub parent_id: Option<Option<i64>>,
}

#[tauri::command]
pub fn project_list(state: State<'_, AppState>) -> Result<Vec<ProjectRow>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let mut stmt = db
    .prepare(
      "SELECT id, title, color, icon, parent_id, created_at, updated_at FROM projects ORDER BY id ASC",
    )
    .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectRow {
                id: row.get(0)?,
                title: row.get(1)?,
                color: row.get(2)?,
                icon: row.get(3)?,
                parent_id: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut projects = Vec::new();
    for row in rows {
        projects.push(row.map_err(|e| e.to_string())?);
    }
    Ok(projects)
}

#[tauri::command]
pub fn project_create(
    state: State<'_, AppState>,
    payload: ProjectCreatePayload,
) -> Result<ProjectRow, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    db.execute(
    "INSERT INTO projects (title, color, icon, parent_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    rusqlite::params![
      payload.title,
      payload.color,
      payload.icon,
      payload.parent_id,
      now,
      now,
    ],
  )
  .map_err(|e| e.to_string())?;

    let id = db.last_insert_rowid();

    Ok(ProjectRow {
        id,
        title: payload.title,
        color: payload.color,
        icon: payload.icon,
        parent_id: payload.parent_id,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn project_update(
    state: State<'_, AppState>,
    payload: ProjectUpdatePayload,
) -> Result<(), String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let mut sets = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref title) = payload.title {
        sets.push("title = ?");
        params.push(Box::new(title.clone()));
    }
    if let Some(ref color) = payload.color {
        sets.push("color = ?");
        params.push(Box::new(color.clone()));
    }
    if let Some(ref icon) = payload.icon {
        sets.push("icon = ?");
        params.push(Box::new(icon.clone()));
    }
    if let Some(ref parent_id) = payload.parent_id {
        sets.push("parent_id = ?");
        params.push(Box::new(*parent_id));
    }

    sets.push("updated_at = ?");
    params.push(Box::new(now));

    params.push(Box::new(payload.id));

    let sql = format!("UPDATE projects SET {} WHERE id = ?", sets.join(", "));
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    db.execute(&sql, param_refs.as_slice())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn project_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    // Don't allow deleting the default inbox project
    if id == 1 {
        return Err("Cannot delete default project".to_string());
    }

    let mut db = state.db().lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;

    // Move tasks from deleted project to inbox (project id=1)
    tx.execute(
        "UPDATE tasks SET project_id = 1, updated_at = ?1 WHERE project_id = ?2",
        rusqlite::params![chrono::Utc::now().to_rfc3339(), id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}
