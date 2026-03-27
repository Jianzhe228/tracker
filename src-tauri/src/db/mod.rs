use rusqlite::Connection;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
use tauri::Manager;

pub struct AppState {
    app_handle: AppHandle,
    db: OnceLock<Mutex<Connection>>,
}

impl AppState {
    pub fn new(app_handle: AppHandle) -> Result<Self, String> {
        let conn =
            init_db(&app_handle).map_err(|e| format!("failed to initialize database: {}", e))?;
        let db = OnceLock::from(Mutex::new(conn));
        Ok(Self { app_handle, db })
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

    run_migrations(&conn)?;

    Ok(conn)
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

pub(crate) fn run_migrations(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);

    if version < 2 {
        // Drop old v1 tables if upgrading from v1
        if version == 1 {
            conn.execute_batch(
                "
          DROP TABLE IF EXISTS habit_checks;
          DROP TABLE IF EXISTS habits;
          DROP TABLE IF EXISTS tasks;
          DROP TABLE IF EXISTS settings;
          ",
            )
            .map_err(|e| format!("failed to drop old v1 tables: {}", e))?;
        }

        // Create all v2 tables
        conn.execute_batch(SCHEMA_V2)
            .map_err(|e| format!("failed to run migration v2: {}", e))?;

        // Insert default project "收集箱" if not exists
        conn
      .execute(
        "INSERT OR IGNORE INTO projects (id, title, color, icon) VALUES (1, '收集箱', '#6b7280', 'inbox')",
        [],
      )
      .map_err(|e| format!("failed to insert default project: {}", e))?;

        conn.execute_batch("PRAGMA user_version = 2;")
            .map_err(|e| format!("failed to set user_version: {}", e))?;
    }

    if version < 3 {
        conn.execute_batch(
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

        PRAGMA user_version = 3;
        ",
        )
        .map_err(|e| format!("failed to run migration v3: {}", e))?;

        // Add recurring_rule_id column if not exists
        let has_recurring_rule_id: bool = conn
            .prepare(
                "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name='recurring_rule_id'",
            )
            .and_then(|mut s| s.query_row([], |r| r.get::<_, i32>(0)))
            .unwrap_or(0)
            > 0;
        if !has_recurring_rule_id {
            conn
        .execute_batch("ALTER TABLE tasks ADD COLUMN recurring_rule_id INTEGER REFERENCES recurring_rules(id) ON DELETE SET NULL;")
        .map_err(|e| format!("failed to add recurring_rule_id column: {}", e))?;
        }

        // Drop legacy columns if they exist
        let drop_cols = ["is_recurring", "repeat_rule"];
        for col in &drop_cols {
            let exists: bool = conn
                .prepare(&format!(
                    "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name='{}'",
                    col
                ))
                .and_then(|mut s| s.query_row([], |r| r.get::<_, i32>(0)))
                .unwrap_or(0)
                > 0;
            if exists {
                conn.execute_batch(&format!("ALTER TABLE tasks DROP COLUMN {};", col))
                    .map_err(|e| format!("failed to drop column {}: {}", col, e))?;
            }
        }
    }

    if version < 4 {
        // Drop legacy columns if they exist
        let drop_cols = ["description", "due_at_postpone_count"];
        for col in &drop_cols {
            let exists: bool = conn
                .prepare(&format!(
                    "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name='{}'",
                    col
                ))
                .and_then(|mut s| s.query_row([], |r| r.get::<_, i32>(0)))
                .unwrap_or(0)
                > 0;
            if exists {
                conn.execute_batch(&format!("ALTER TABLE tasks DROP COLUMN {};", col))
                    .map_err(|e| format!("failed to drop column {}: {}", col, e))?;
            }
        }

        conn.execute_batch("PRAGMA user_version = 4;")
            .map_err(|e| format!("failed to set user_version to 4: {}", e))?;
    }

    if version < 5 {
        conn.execute_batch(
            "
        DROP TABLE IF EXISTS habit_stats;
        DROP TABLE IF EXISTS habit_logs;
        DROP TABLE IF EXISTS habits;

        PRAGMA user_version = 5;
        ",
        )
        .map_err(|e| format!("failed to run migration v5: {}", e))?;
    }

    if version < 6 {
        conn.execute_batch(
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
        .map_err(|e| format!("failed to run migration v6: {}", e))?;
    }

    if version < 7 {
        conn.execute_batch(
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
        .map_err(|e| format!("failed to run migration v7: {}", e))?;

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
      .map_err(|e| format!("failed to seed task_decompose skill: {}", e))?;
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
      .map_err(|e| format!("failed to update task_decompose prompt: {}", e))?;

        conn.execute_batch("PRAGMA user_version = 8;")
            .map_err(|e| format!("failed to set user_version to 8: {}", e))?;
    }

    if version < 9 {
        conn.execute_batch(
            "
        ALTER TABLE tasks ADD COLUMN start_at DATETIME;

        PRAGMA user_version = 9;
        ",
        )
        .map_err(|e| format!("failed to run migration v9: {}", e))?;
    }

    if version < 10 {
        conn.execute_batch(
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
        .map_err(|e| format!("failed to run migration v10: {}", e))?;

        // v10 prompt replaced by v11 below
    }

    if version < 11 {
        conn
      .execute_batch(
        "
        -- Suggestion feedback tracking
        CREATE TABLE IF NOT EXISTS suggestion_feedback (
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

        CREATE INDEX IF NOT EXISTS idx_suggestion_feedback_project ON suggestion_feedback(project_id);
        CREATE INDEX IF NOT EXISTS idx_suggestion_feedback_source ON suggestion_feedback(source, action);

        -- Task subtask history (snapshot on completion)
        CREATE TABLE IF NOT EXISTS task_subtask_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_task_id INTEGER NOT NULL,
            parent_title TEXT NOT NULL,
            project_id INTEGER,
            subtask_titles TEXT NOT NULL DEFAULT '[]',
            captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_task_subtask_history_title ON task_subtask_history(parent_title);

        PRAGMA user_version = 11;
        ",
      )
      .map_err(|e| format!("failed to run migration v11: {}", e))?;

        // Replace task_decompose prompt with universal version
        conn
      .execute(
        "UPDATE ai_skills SET
           system_prompt = 'You are a task checklist assistant. Suggest short, specific action items.

RULES:
1. INFER task type from title. Study → study actions. Travel → logistics. Work → deliverables.
2. KEEP EACH ITEM VERY SHORT: 2-6 words max. Examples: \"携带身份证\", \"定闹钟\", \"复习单词\", \"检查车票\", \"约见面地点\"
3. Only suggest concrete, specific items — NOT vague steps like \"做准备\", \"确认安排\"
4. Do NOT suggest meta-tasks: \"制定计划\", \"确认时间\", \"总结复盘\"
5. Count: simple tasks 2-3 items, normal 3-5, detailed 5-8
6. Same language as task title
7. If user history provided, follow their patterns
8. If rejected items provided, avoid similar suggestions

Return JSON only: {\"actions\": [{\"type\": \"create_subtask\", \"params\": {\"title\": \"...\"}}]}',
           user_prompt_template = 'Task: {{taskTitle}}
Project: {{projectName}}
Detail level: {{detailLevel}}
{{#if userPatterns}}User''s typical subtasks for similar tasks: {{userPatterns}}{{/if}}
{{#if learnedItems}}Previously accepted suggestions: {{learnedItems}}{{/if}}
{{#if rejectedItems}}Previously rejected (avoid these): {{rejectedItems}}{{/if}}
{{#if manualSubtasks}}User''s manually created subtasks for similar tasks: {{manualSubtasks}}{{/if}}
{{#if siblingTasks}}Other tasks in same project: {{siblingTasks}}{{/if}}',
           updated_at = CURRENT_TIMESTAMP
         WHERE key = 'task_decompose' AND is_builtin = 1",
        [],
      )
      .map_err(|e| format!("failed to update task_decompose prompt v11: {}", e))?;
    }

    if version < 12 {
        // Optimize task_decompose prompt: Chinese few-shot + history-first approach
        // Test results show this produces shorter, more specific suggestions
        // that better leverage user history patterns.
        conn.execute(
            "UPDATE ai_skills SET
           system_prompt = '你给任务生成待办清单。

【格式】每条 3-8 字，动词开头，可直接执行
【数量】2-5 条
【重点】有用户历史时，优先参考用户习惯生成风格一致的建议；有拒绝记录时，避免类似项

❌ 空泛: \"做好准备\" \"确认安排\" \"制定计划\" \"了解情况\" \"准备材料\" \"总结复盘\"
✅ 具体: \"订机票\" \"带身份证\" \"背单词\" \"查报错日志\" \"拖地\" \"买牛奶\"

示例:
出差去上海 → [\"订机票\",\"订酒店\",\"带充电器\",\"查会议地址\"]
准备期末考试 → [\"背重点公式\",\"做两套真题\",\"整理错题本\"]
修复首页白屏 → [\"复现问题\",\"查控制台报错\",\"定位异常组件\"]
周末大扫除 → [\"拖地\",\"擦窗户\",\"整理衣柜\"]

仅返回JSON: {\"actions\": [{\"type\": \"create_subtask\", \"params\": {\"title\": \"...\"}}]}',
           user_prompt_template = '{{taskTitle}}
{{#if projectName}}[{{projectName}}]{{/if}}
{{#if learnedItems}}参考: {{learnedItems}}{{/if}}
{{#if manualSubtasks}}历史: {{manualSubtasks}}{{/if}}
{{#if rejectedItems}}避免: {{rejectedItems}}{{/if}}
{{#if userPatterns}}常用: {{userPatterns}}{{/if}}',
           updated_at = CURRENT_TIMESTAMP
         WHERE key = 'task_decompose' AND is_builtin = 1",
            [],
        )
        .map_err(|e| format!("failed to update task_decompose prompt v12: {}", e))?;

        conn.execute_batch("PRAGMA user_version = 12;")
            .map_err(|e| format!("failed to set user_version to 12: {}", e))?;
    }

    if version < 13 {
        conn.execute_batch(
            "
        CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at);
        CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_project_deleted ON tasks(project_id, deleted_at);
        CREATE INDEX IF NOT EXISTS idx_focus_sessions_start_time ON focus_sessions(start_time);
        CREATE INDEX IF NOT EXISTS idx_focus_sessions_task_id ON focus_sessions(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_tags_task_id ON task_tags(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_tags_tag_id ON task_tags(tag_id);

        PRAGMA user_version = 13;
        ",
        )
        .map_err(|e| format!("failed to run migration v13: {}", e))?;
    }

    if version < 14 {
        conn.execute("DELETE FROM user_settings WHERE key = 'aiDetailLevel'", [])
            .map_err(|e| format!("failed to clean up aiDetailLevel setting: {}", e))?;

        conn.execute_batch("PRAGMA user_version = 14;")
            .map_err(|e| format!("failed to set user_version to 14: {}", e))?;
    }

    if version < 15 {
        conn.execute_batch(
            "
        ALTER TABLE tasks ADD COLUMN rescheduled_to TEXT;

        PRAGMA user_version = 15;
        ",
        )
        .map_err(|e| format!("failed to run migration v15: {}", e))?;
    }

    if version < 16 {
        conn.execute_batch(
            "
        -- AI prediction: task creation history for AI analysis
        CREATE TABLE IF NOT EXISTS task_creation_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_title TEXT NOT NULL,
            project_id INTEGER,
            created_at TEXT NOT NULL,
            dow TEXT,
            hour INTEGER,
            day_of_month INTEGER,
            is_recurring_instance INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_task_creation_history_created_at ON task_creation_history(created_at);
        CREATE INDEX IF NOT EXISTS idx_task_creation_history_dow_hour ON task_creation_history(dow, hour);

        -- AI prediction: pending predictions from AI analysis
        CREATE TABLE IF NOT EXISTS pending_predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            reason TEXT,
            predicted_for_date TEXT,
            created_at TEXT,
            notified_at TEXT,
            status TEXT DEFAULT 'pending',
            ai_context TEXT,
            source_job_id INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_pending_predictions_status ON pending_predictions(status);
        CREATE INDEX IF NOT EXISTS idx_pending_predictions_predicted_for_date ON pending_predictions(predicted_for_date);

        PRAGMA user_version = 16;
        ",
        )
        .map_err(|e| format!("failed to run migration v16: {}", e))?;
    }

    if version < 17 {
        // Seed builtin skill: task_history_analyzer for AI-driven prediction
        let system_prompt = "你是一个用户行为分析师。分析用户的历史任务创建记录，发现时间模式和语义规律。\n\n你的任务是：\n1. 从提供的历史任务数据中，发现周期性规律\n2. 识别高频任务的语义类别（如'周计划'、'月度总结'、'项目复盘'）\n3. 结合当前时间上下文，预测用户今天/明天可能想创建什么任务\n4. 为每个预测给出简洁的理由\n\n规则：\n- 预测要具体、可执行（如'创建本周计划'而非'做计划'）\n- 关注重复性模式，而非一次性事件\n- 如果历史数据不足（<7条），给出通用的今日建议\n- 每组预测不超过 3 条\n- 不要预测已有或近期创建过的任务\n\n返回 JSON：\n{\n  \"detected_patterns\": [\n    {\"pattern\": \"每周一早上\", \"typical_tasks\": [\"周计划\", \"本周目标\"]}\n  ],\n  \"predictions\": [\n    {\"title\": \"创建本周计划\", \"reason\": \"你每周一常规划本周工作\"}\n  ]\n}";
        let user_prompt_template = "当前时间：{{currentTime}}（{{dayOfWeek}}）\n\n用户近 {{days}} 天创建的任务（共 {{count}} 条）：\n{{taskList}}\n\n{{#if recentProjects}}近期涉及的项目：{{recentProjects}}{{/if}}";

        conn.execute(
            "INSERT OR IGNORE INTO ai_skills (key, name, description, system_prompt, user_prompt_template, action_types, trigger_type, is_builtin, enabled)
             VALUES ('task_history_analyzer', '任务历史分析', '分析用户历史任务创建记录，发现时间模式和语义规律，预测用户可能想创建的任务', ?1, ?2, '[]', 'scheduled', 1, 1)",
            rusqlite::params![system_prompt, user_prompt_template],
        )
        .map_err(|e| format!("failed to seed task_history_analyzer skill: {}", e))?;

        conn.execute_batch("PRAGMA user_version = 17;")
            .map_err(|e| format!("failed to set user_version to 17: {}", e))?;
    }

    Ok(())
}
