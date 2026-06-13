use rusqlite::{params, Connection};
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
use tauri::Manager;

pub struct AppState {
    _app_handle: AppHandle,
    db: OnceLock<Mutex<Connection>>,
}

impl AppState {
    pub fn new(app_handle: AppHandle) -> Result<Self, String> {
        let conn =
            init_db(&app_handle).map_err(|e| format!("failed to initialize database: {}", e))?;
        let db = OnceLock::from(Mutex::new(conn));
        Ok(Self {
            _app_handle: app_handle,
            db,
        })
    }

    pub fn db(&self) -> &Mutex<Connection> {
        self.db.get().expect("db not initialized")
    }
}

fn init_db(app: &AppHandle) -> Result<Connection, Box<dyn std::error::Error>> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {}", e))?;
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("cannot create app data dir: {}", e))?;

    let db_path = app_dir.join("tracker.db");
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("cannot open database at {}: {}", db_path.display(), e))?;

    // Enable WAL mode for better concurrency
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    // Enable foreign keys
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("cannot enable foreign keys: {}", e))?;

    // Snapshot the database before an in-place schema upgrade: older builds
    // reject newer schemas, so this file is the only road back after a
    // problematic update.
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);
    if version > 0 && version < SCHEMA_VERSION {
        let backup_path = app_dir.join(format!("tracker.pre-v{}.db", version));
        if !backup_path.exists() {
            conn.execute("VACUUM INTO ?1", [backup_path.to_string_lossy().as_ref()])
                .map_err(|e| format!("cannot back up database before upgrade: {}", e))?;
        }
    }

    run_migrations(&conn)?;

    Ok(conn)
}

/// Current schema version.
///
/// This branch treats the database as a brand-new design: v1 IS the first
/// version, and databases created by any earlier build are not supported.
/// There is no incremental migration ladder — a fresh database is created in
/// one shot from `BASELINE_SCHEMA`.
///
/// When changing the schema later: fold the change into `BASELINE_SCHEMA`,
/// add a single "previous -> new" upgrade arm in `run_migrations`, and bump
/// this constant. Do not accumulate upgrade paths.
const SCHEMA_VERSION: i32 = 2;

/// Full schema as of `SCHEMA_VERSION`, applied to fresh databases in one
/// transaction.
const BASELINE_SCHEMA: &str = "
-- user_settings
CREATE TABLE user_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- projects
CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    color TEXT,
    icon TEXT,
    parent_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- recurring_rules
CREATE TABLE recurring_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    priority INTEGER DEFAULT 0,
    project_id INTEGER,
    repeat_type TEXT NOT NULL,
    repeat_days TEXT,
    anchor_date TEXT NOT NULL,
    reminder_time TEXT,
    notes TEXT,
    pomodoro_count INTEGER DEFAULT 1,
    pomodoro_duration INTEGER DEFAULT 25,
    active BOOLEAN DEFAULT 1,
    last_generated_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- tasks
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    priority INTEGER DEFAULT 0,
    project_id INTEGER,
    parent_id INTEGER,
    due_at DATETIME,
    reminder_time DATETIME,
    completed_at DATETIME,
    deleted_at DATETIME,
    notes TEXT,
    pomodoro_count INTEGER DEFAULT 1,
    pomodoro_duration INTEGER DEFAULT 25,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    recurring_rule_id INTEGER REFERENCES recurring_rules(id) ON DELETE SET NULL,
    start_at DATETIME,
    rescheduled_to TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_tasks_deleted_at ON tasks(deleted_at);
CREATE INDEX idx_tasks_parent_id ON tasks(parent_id);
CREATE INDEX idx_tasks_project_deleted ON tasks(project_id, deleted_at);

-- Archive paging: ORDER BY completed_at DESC, id DESC over status IN ('done','cancelled').
CREATE INDEX idx_tasks_archive_ts
  ON tasks(completed_at DESC, id DESC)
  WHERE deleted_at IS NULL AND status IN ('done', 'cancelled');

-- Working-set base CTE: filter by status and recent completed_at.
CREATE INDEX idx_tasks_status_completed
  ON tasks(status, completed_at)
  WHERE deleted_at IS NULL;

-- focus_sessions
CREATE TABLE focus_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    duration_seconds INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    interruption_reason TEXT,
    pomodoro_count INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX idx_focus_sessions_start_time ON focus_sessions(start_time);
CREATE INDEX idx_focus_sessions_task_id ON focus_sessions(task_id);

-- focus_session_segments (split on task switch)
CREATE TABLE focus_session_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    task_id INTEGER,
    start_time DATETIME NOT NULL,
    duration_seconds INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES focus_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- notification_logs
CREATE TABLE notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    payload TEXT,
    is_read BOOLEAN DEFAULT 0,
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notification_logs_created_at ON notification_logs(created_at);
CREATE INDEX idx_notification_logs_type_created_at ON notification_logs(type, created_at);
CREATE INDEX idx_notification_logs_is_read_created_at ON notification_logs(is_read, created_at);

-- task_completion_logs (estimated vs actual)
CREATE TABLE task_completion_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    task_title TEXT NOT NULL,
    estimated_seconds INTEGER NOT NULL,
    actual_seconds INTEGER NOT NULL,
    deviation_percentage REAL,
    deviation_reason TEXT,
    reflection TEXT,
    next_improvement TEXT,
    personal_notes TEXT,
    completed_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- task_deletion_logs
CREATE TABLE task_deletion_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    task_title TEXT NOT NULL,
    deleted_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ai_skills (prompt templates live in the DB)
CREATE TABLE ai_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL,
    user_prompt_template TEXT NOT NULL,
    action_types TEXT NOT NULL DEFAULT '[]',
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ai_jobs (async AI work queue)
CREATE TABLE ai_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id INTEGER NOT NULL REFERENCES ai_skills(id),
    status TEXT NOT NULL DEFAULT 'pending',
    input_context TEXT NOT NULL DEFAULT '{}',
    raw_response TEXT,
    actions TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE INDEX idx_ai_jobs_status ON ai_jobs(status);
CREATE INDEX idx_ai_jobs_skill_id ON ai_jobs(skill_id);

-- subtask_patterns (pattern template library)
CREATE TABLE subtask_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    subtasks TEXT NOT NULL DEFAULT '[]',
    project_id INTEGER,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    usage_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- subtask_learn_log (keyword -> subtask behaviour learning)
CREATE TABLE subtask_learn_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id INTEGER,
    project_id INTEGER,
    keyword TEXT NOT NULL,
    subtask_title TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 1,
    source TEXT DEFAULT 'user',
    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX idx_subtask_learn_keyword ON subtask_learn_log(keyword);
CREATE INDEX idx_subtask_learn_project ON subtask_learn_log(project_id);

-- keyword_clusters (semantic keyword grouping)
CREATE TABLE keyword_clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    confirmed INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- suggestion_feedback (accept/reject tracking)
CREATE TABLE suggestion_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    task_title TEXT NOT NULL,
    project_id INTEGER,
    suggestion_title TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'ai',
    action TEXT NOT NULL DEFAULT 'pending',
    job_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_suggestion_feedback_project ON suggestion_feedback(project_id);
CREATE INDEX idx_suggestion_feedback_source ON suggestion_feedback(source, action);

-- task_subtask_history (subtask snapshot on completion)
CREATE TABLE task_subtask_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_task_id INTEGER NOT NULL,
    parent_title TEXT NOT NULL,
    project_id INTEGER,
    subtask_titles TEXT NOT NULL DEFAULT '[]',
    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_task_subtask_history_title ON task_subtask_history(parent_title);

-- task_creation_history (input for the local prediction engine)
CREATE TABLE task_creation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_title TEXT NOT NULL,
    project_id INTEGER,
    created_at TEXT NOT NULL,
    dow TEXT,
    hour INTEGER,
    day_of_month INTEGER,
    is_recurring_instance INTEGER DEFAULT 0
);

CREATE INDEX idx_task_creation_history_created_at ON task_creation_history(created_at);
CREATE INDEX idx_task_creation_history_dow_hour ON task_creation_history(dow, hour);

-- pending_predictions (local prediction engine output)
CREATE TABLE pending_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    reason TEXT,
    predicted_for_date TEXT,
    created_at TEXT,
    notified_at TEXT,
    actioned_at TEXT,
    status TEXT DEFAULT 'pending',
    project_id INTEGER,
    title_key TEXT,
    score REAL,
    score_breakdown TEXT,
    algorithm_version TEXT
);

CREATE INDEX idx_pending_predictions_status ON pending_predictions(status);
CREATE INDEX idx_pending_predictions_predicted_for_date ON pending_predictions(predicted_for_date);
CREATE INDEX idx_pending_predictions_algorithm_version
  ON pending_predictions(algorithm_version, created_at);
CREATE INDEX idx_pending_predictions_title_key
  ON pending_predictions(title_key, project_id, status);

-- suggestion_runs (suggestion pipeline trace)
CREATE TABLE suggestion_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    task_title TEXT NOT NULL,
    project_id INTEGER,
    analysis_json TEXT NOT NULL DEFAULT '{}',
    strategy TEXT NOT NULL DEFAULT 'ai',
    ranker_version TEXT NOT NULL DEFAULT 'v1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_suggestion_runs_task_id ON suggestion_runs(task_id);
CREATE INDEX idx_suggestion_runs_created_at ON suggestion_runs(created_at);

-- suggestion_candidates (per-run candidate trace)
CREATE TABLE suggestion_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES suggestion_runs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    merged_sources_json TEXT NOT NULL DEFAULT '[]',
    score REAL NOT NULL DEFAULT 0,
    evidence_json TEXT NOT NULL DEFAULT '[]',
    reasons_json TEXT NOT NULL DEFAULT '[]',
    shown_rank INTEGER,
    selected INTEGER NOT NULL DEFAULT 0,
    rejected INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_suggestion_candidates_run_id ON suggestion_candidates(run_id);
";

const TASK_DECOMPOSE_SYSTEM_PROMPT: &str = r#"你给任务生成待办清单。

【格式】每条 3-8 字，动词开头，可直接执行
【数量】2-5 条
【重点】有用户历史时，优先参考用户习惯生成风格一致的建议；有拒绝记录时，避免类似项

❌ 空泛: "做好准备" "确认安排" "制定计划" "了解情况" "准备材料" "总结复盘"
✅ 具体: "订机票" "带身份证" "背单词" "查报错日志" "拖地" "买牛奶"

示例:
出差去上海 → ["订机票","订酒店","带充电器","查会议地址"]
准备期末考试 → ["背重点公式","做两套真题","整理错题本"]
修复首页白屏 → ["复现问题","查控制台报错","定位异常组件"]
周末大扫除 → ["拖地","擦窗户","整理衣柜"]

仅返回JSON: {"actions": [{"type": "create_subtask", "params": {"title": "..."}}]}"#;

const TASK_DECOMPOSE_USER_TEMPLATE: &str = r#"{{taskTitle}}
{{#if projectName}}[{{projectName}}]{{/if}}
{{#if learnedItems}}参考: {{learnedItems}}{{/if}}
{{#if manualSubtasks}}历史: {{manualSubtasks}}{{/if}}
{{#if rejectedItems}}避免: {{rejectedItems}}{{/if}}
{{#if userPatterns}}常用: {{userPatterns}}{{/if}}"#;

const HISTORY_ANALYZER_SYSTEM_PROMPT: &str = "你是一个用户行为分析师。分析用户的历史任务创建记录，发现时间模式和语义规律。\n\n你的任务是：\n1. 从提供的历史任务数据中，发现周期性规律\n2. 识别高频任务的语义类别（如'周计划'、'月度总结'、'项目复盘'）\n3. 结合当前时间上下文，预测用户今天/明天可能想创建什么任务\n4. 为每个预测给出简洁的理由\n\n规则：\n- 预测要具体、可执行（如'创建本周计划'而非'做计划'）\n- 关注重复性模式，而非一次性事件\n- 如果历史数据不足（<7条），给出通用的今日建议\n- 每组预测不超过 3 条\n- 不要预测已有或近期创建过的任务\n\n返回 JSON：\n{\n  \"detected_patterns\": [\n    {\"pattern\": \"每周一早上\", \"typical_tasks\": [\"周计划\", \"本周目标\"]}\n  ],\n  \"predictions\": [\n    {\"title\": \"创建本周计划\", \"reason\": \"你每周一常规划本周工作\"}\n  ]\n}";

const HISTORY_ANALYZER_USER_TEMPLATE: &str = "当前时间：{{currentTime}}（{{dayOfWeek}}）\n\n用户近 {{days}} 天创建的任务（共 {{count}} 条）：\n{{taskList}}\n\n{{#if recentProjects}}近期涉及的项目：{{recentProjects}}{{/if}}";

/// Seed data every database must contain: the inbox project and the two
/// builtin AI skills.
pub(crate) fn seed_builtin_data(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    conn.execute(
        "INSERT INTO projects (id, title, color, icon) VALUES (1, '收集箱', '#6b7280', 'inbox')",
        [],
    )
    .map_err(|e| format!("failed to seed inbox project: {}", e))?;

    conn.execute(
        "INSERT INTO ai_skills (key, name, description, system_prompt, user_prompt_template, action_types, trigger_type, is_builtin, enabled)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 1)",
        params![
            "task_decompose",
            "任务拆解",
            "自动分析任务并建议子任务",
            TASK_DECOMPOSE_SYSTEM_PROMPT,
            TASK_DECOMPOSE_USER_TEMPLATE,
            r#"["create_subtask", "update_task"]"#,
            "on_task_create",
        ],
    )
    .map_err(|e| format!("failed to seed task_decompose skill: {}", e))?;

    conn.execute(
        "INSERT INTO ai_skills (key, name, description, system_prompt, user_prompt_template, action_types, trigger_type, is_builtin, enabled)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 1)",
        params![
            "task_history_analyzer",
            "任务历史分析",
            "分析用户历史任务创建记录，发现时间模式和语义规律，预测用户可能想创建的任务",
            HISTORY_ANALYZER_SYSTEM_PROMPT,
            HISTORY_ANALYZER_USER_TEMPLATE,
            "[]",
            "scheduled",
        ],
    )
    .map_err(|e| format!("failed to seed task_history_analyzer skill: {}", e))?;

    Ok(())
}

pub(crate) fn run_migrations(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);

    match version {
        SCHEMA_VERSION => Ok(()),
        0 => {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(BASELINE_SCHEMA)
                .map_err(|e| format!("failed to create baseline schema: {}", e))?;
            seed_builtin_data(&tx)?;
            tx.execute_batch(&format!("PRAGMA user_version = {};", SCHEMA_VERSION))
                .map_err(|e| format!("failed to set user_version: {}", e))?;
            tx.commit()?;
            Ok(())
        }
        // v1 -> v2: prediction feedback needs the exact accept/reject time
        // (created_at is the generation time, which can be days earlier).
        1 => {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch("ALTER TABLE pending_predictions ADD COLUMN actioned_at TEXT;")
                .map_err(|e| format!("failed to upgrade schema v1 -> v2: {}", e))?;
            tx.execute_batch(&format!("PRAGMA user_version = {};", SCHEMA_VERSION))
                .map_err(|e| format!("failed to set user_version: {}", e))?;
            tx.commit()?;
            Ok(())
        }
        v => Err(format!(
            "unsupported database schema version {}; this database was created by an \
             incompatible build — back up and remove tracker.db to start fresh",
            v
        )
        .into()),
    }
}

#[cfg(test)]
mod tests {
    use super::{run_migrations, SCHEMA_VERSION};
    use rusqlite::Connection;

    fn user_version(conn: &Connection) -> i32 {
        conn.pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read user_version")
    }

    fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
        let sql = format!(
            "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = ?1",
            table
        );
        let n: i64 = conn
            .query_row(&sql, [column], |row| row.get(0))
            .expect("pragma_table_info");
        n > 0
    }

    #[test]
    fn fresh_database_is_created_at_baseline_version() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        run_migrations(&conn).expect("run migrations");

        assert_eq!(user_version(&conn), SCHEMA_VERSION);
        assert!(column_exists(&conn, "tasks", "recurring_rule_id"));
        assert!(column_exists(&conn, "tasks", "start_at"));
        assert!(column_exists(&conn, "tasks", "rescheduled_to"));
        assert!(column_exists(&conn, "pending_predictions", "algorithm_version"));
        assert!(column_exists(&conn, "pending_predictions", "actioned_at"));

        let inbox: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM projects WHERE id = 1 AND title = '收集箱'",
                [],
                |r| r.get(0),
            )
            .expect("inbox seeded");
        assert_eq!(inbox, 1);

        let skills: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ai_skills WHERE is_builtin = 1 AND enabled = 1",
                [],
                |r| r.get(0),
            )
            .expect("builtin skills seeded");
        assert_eq!(skills, 2);

        // Retired tables from the pre-v1 design must not exist.
        let retired: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'
                 AND name IN ('tags', 'task_tags', 'ai_logs', 'daily_summaries')",
                [],
                |r| r.get(0),
            )
            .expect("check retired tables");
        assert_eq!(retired, 0);
    }

    #[test]
    fn migrations_are_idempotent_at_latest_version() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        run_migrations(&conn).expect("first run");
        run_migrations(&conn).expect("second run");
        assert_eq!(user_version(&conn), SCHEMA_VERSION);
    }

    #[test]
    fn v1_database_is_upgraded_to_v2() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        // Recreate a v1 database: baseline minus the v2 actioned_at column.
        conn.execute_batch(
            "CREATE TABLE pending_predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                reason TEXT,
                predicted_for_date TEXT,
                created_at TEXT,
                notified_at TEXT,
                status TEXT DEFAULT 'pending',
                project_id INTEGER,
                title_key TEXT,
                score REAL,
                score_breakdown TEXT,
                algorithm_version TEXT
            );
            PRAGMA user_version = 1;",
        )
        .expect("create v1 table");

        run_migrations(&conn).expect("upgrade v1 -> v2");

        assert_eq!(user_version(&conn), SCHEMA_VERSION);
        assert!(column_exists(&conn, "pending_predictions", "actioned_at"));
    }

    #[test]
    fn databases_older_than_previous_release_are_rejected() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA user_version = 17;")
            .expect("mark as v17");

        let err = run_migrations(&conn).expect_err("old schema must be rejected");
        assert!(err
            .to_string()
            .contains("unsupported database schema version 17"));
    }
}
