use rusqlite::Connection;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
use tauri::Manager;

pub struct AppState {
  app_handle: AppHandle,
  db: OnceLock<Mutex<Connection>>,
}

impl AppState {
  pub fn new(app_handle: AppHandle) -> Self {
    Self {
      app_handle,
      db: OnceLock::new(),
    }
  }

  pub fn db(&self) -> &Mutex<Connection> {
    self.db.get_or_init(|| {
      Mutex::new(init_db(&self.app_handle))
    })
  }
}

fn init_db(app: &AppHandle) -> Connection {
  let app_dir = app
    .path()
    .app_data_dir()
    .expect("failed to resolve app data dir");
  std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

  let db_path = app_dir.join("tracker.db");
  let conn = Connection::open(&db_path).expect("failed to open database");

  // Enable WAL mode for better concurrency
  conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
  // Enable foreign keys
  conn
    .execute_batch("PRAGMA foreign_keys=ON;")
    .expect("failed to enable foreign keys");

  run_migrations(&conn);

  conn
}

const SCHEMA_V2: &str = "
-- 3.1.1 user_settings
CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3.1.2 projects
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    color TEXT,
    icon TEXT,
    parent_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- 3.1.3 tags
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3.1.4 tasks
CREATE TABLE IF NOT EXISTS tasks (
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
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- 3.1.5 task_tags
CREATE TABLE IF NOT EXISTS task_tags (
    task_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id, tag_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 3.1.6 focus_sessions
CREATE TABLE IF NOT EXISTS focus_sessions (
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

-- 3.1.7 ai_logs
CREATE TABLE IF NOT EXISTS ai_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_type TEXT NOT NULL,
    context TEXT,
    suggestion TEXT NOT NULL,
    user_action TEXT,
    user_feedback TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3.1.7.1 notification_logs
CREATE TABLE IF NOT EXISTS notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    payload TEXT,
    is_read BOOLEAN DEFAULT 0,
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_type_created_at ON notification_logs(type, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_is_read_created_at ON notification_logs(is_read, created_at);

-- 3.1.8 task_completion_logs
CREATE TABLE IF NOT EXISTS task_completion_logs (
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

-- 3.1.9 task_deletion_logs
CREATE TABLE IF NOT EXISTS task_deletion_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    task_title TEXT NOT NULL,
    deleted_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3.1.10 daily_summaries
CREATE TABLE IF NOT EXISTS daily_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    total_focus_seconds INTEGER DEFAULT 0,
    total_pomodoros INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_created INTEGER DEFAULT 0,
    interruptions INTEGER DEFAULT 0,
    hourly_distribution TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
";

fn run_migrations(conn: &Connection) {
  let version: i32 = conn
    .pragma_query_value(None, "user_version", |row| row.get(0))
    .unwrap_or(0);

  if version < 2 {
    // Drop old v1 tables if upgrading from v1
    if version == 1 {
      conn
        .execute_batch(
          "
          DROP TABLE IF EXISTS habit_checks;
          DROP TABLE IF EXISTS habits;
          DROP TABLE IF EXISTS tasks;
          DROP TABLE IF EXISTS settings;
          ",
        )
        .expect("failed to drop old v1 tables");
    }

    // Create all v2 tables
    conn
      .execute_batch(SCHEMA_V2)
      .expect("failed to run migration v2");

    // Insert default project "收集箱" if not exists
    conn
      .execute(
        "INSERT OR IGNORE INTO projects (id, title, color, icon) VALUES (1, '收集箱', '#6b7280', 'inbox')",
        [],
      )
      .expect("failed to insert default project");

    conn
      .execute_batch("PRAGMA user_version = 2;")
      .expect("failed to set user_version");
  }

  if version < 3 {
    conn
      .execute_batch(
        "
        CREATE TABLE IF NOT EXISTS recurring_rules (
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

        ALTER TABLE tasks ADD COLUMN recurring_rule_id INTEGER
            REFERENCES recurring_rules(id) ON DELETE SET NULL;

        ALTER TABLE tasks DROP COLUMN is_recurring;
        ALTER TABLE tasks DROP COLUMN repeat_rule;

        PRAGMA user_version = 3;
        ",
      )
      .expect("failed to run migration v3");
  }

  if version < 4 {
    conn
      .execute_batch(
        "
        ALTER TABLE tasks DROP COLUMN description;
        ALTER TABLE tasks DROP COLUMN due_at_postpone_count;

        PRAGMA user_version = 4;
        ",
      )
      .expect("failed to run migration v4");
  }

  if version < 5 {
    conn
      .execute_batch(
        "
        DROP TABLE IF EXISTS habit_stats;
        DROP TABLE IF EXISTS habit_logs;
        DROP TABLE IF EXISTS habits;

        PRAGMA user_version = 5;
        ",
      )
      .expect("failed to run migration v5");
  }

  if version < 6 {
    conn
      .execute_batch(
        "
        CREATE TABLE IF NOT EXISTS focus_session_segments (
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

        PRAGMA user_version = 6;
        ",
      )
      .expect("failed to run migration v6");
  }

  if version < 7 {
    conn
      .execute_batch(
        "
        CREATE TABLE IF NOT EXISTS ai_skills (
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

        CREATE TABLE IF NOT EXISTS ai_jobs (
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

        CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_ai_jobs_skill_id ON ai_jobs(skill_id);

        PRAGMA user_version = 7;
        ",
      )
      .expect("failed to run migration v7");

    // Seed builtin skill: task_decompose
    conn
      .execute(
        "INSERT OR IGNORE INTO ai_skills (key, name, description, system_prompt, user_prompt_template, action_types, trigger_type, is_builtin, enabled)
         VALUES ('task_decompose', '任务拆解', '自动分析任务并建议子任务',
           'You are a task planning assistant. Analyze the task and suggest subtasks. Return JSON only: {\"actions\": [{\"type\": \"create_subtask\", \"params\": {\"title\": \"...\"}}], \"reasoning\": \"...\"}. Keep subtasks concise and actionable. Max 8 subtasks.',
           'Task: {{taskTitle}}\nExisting tasks: {{existingTasks}}',
           '[\"create_subtask\", \"update_task\"]',
           'on_task_create', 1, 1)",
        [],
      )
      .expect("failed to seed task_decompose skill");
  }

  if version < 8 {
    // Update task_decompose prompt to support detail level
    conn
      .execute(
        "UPDATE ai_skills SET
           system_prompt = 'You are a task planning assistant. Analyze the task and suggest subtasks based on the requested detail level.

Detail levels:
- simple: 1-2 key action items only, skip obvious steps
- normal: 2-4 practical steps
- detailed: 4-8 comprehensive steps

Return JSON only: {\"actions\": [{\"type\": \"create_subtask\", \"params\": {\"title\": \"...\"}}], \"reasoning\": \"...\"}. Keep subtasks concise and actionable. Use the same language as the task title.',
           user_prompt_template = 'Task: {{taskTitle}}
Detail level: {{detailLevel}}
Existing tasks: {{existingTasks}}',
           updated_at = CURRENT_TIMESTAMP
         WHERE key = 'task_decompose' AND is_builtin = 1",
        [],
      )
      .expect("failed to update task_decompose prompt");

    conn
      .execute_batch("PRAGMA user_version = 8;")
      .expect("failed to set user_version to 8");
  }

  if version < 9 {
    conn
      .execute_batch(
        "
        ALTER TABLE tasks ADD COLUMN start_at DATETIME;

        PRAGMA user_version = 9;
        ",
      )
      .expect("failed to run migration v9");
  }

  if version < 10 {
    conn
      .execute_batch(
        "
        -- Subtask pattern templates
        CREATE TABLE IF NOT EXISTS subtask_patterns (
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

        -- User behavior learning log
        CREATE TABLE IF NOT EXISTS subtask_learn_log (
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

        CREATE INDEX IF NOT EXISTS idx_subtask_learn_keyword ON subtask_learn_log(keyword);
        CREATE INDEX IF NOT EXISTS idx_subtask_learn_project ON subtask_learn_log(project_id);

        -- Keyword clusters for grouping related keywords
        CREATE TABLE IF NOT EXISTS keyword_clusters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            keywords TEXT NOT NULL DEFAULT '[]',
            confirmed INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        PRAGMA user_version = 10;
        ",
      )
      .expect("failed to run migration v10");

    // Update task_decompose AI prompt to be more concise and context-aware
    conn
      .execute(
        "UPDATE ai_skills SET
           system_prompt = 'You are a concise task checklist assistant. Suggest only KEY items the user needs to prepare or check — like a quick packing list, NOT a project plan.

Rules:
- Max 3-4 items for simple tasks, max 5-6 for complex tasks
- Each item should be a noun or short noun phrase (e.g. \"水杯\", \"充电器\", \"简历打印\")
- Do NOT suggest obvious/generic steps like \"确认时间\", \"规划路线\", \"检查天气\"
- Do NOT suggest meta-tasks like \"制定计划\", \"总结复盘\"
- Think like a real person: what would they actually forget or need to check?
- Use the same language as the task title
- If user patterns are provided, prioritize items consistent with their history

Return JSON only: {\"actions\": [{\"type\": \"create_subtask\", \"params\": {\"title\": \"...\"}}]}',
           user_prompt_template = 'Task: {{taskTitle}}
Project: {{projectName}}
{{#if userPatterns}}User''s usual checklist for similar tasks: {{userPatterns}}{{/if}}
{{#if learnedItems}}Previously adopted items: {{learnedItems}}{{/if}}',
           updated_at = CURRENT_TIMESTAMP
         WHERE key = 'task_decompose' AND is_builtin = 1",
        [],
      )
      .expect("failed to update task_decompose prompt v10");
  }
}
