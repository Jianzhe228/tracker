# AI 预测任务创建建议

## 目标

让 AI 自动分析用户的历史任务创建记录，发现时间模式和语义规律，主动预测用户可能想创建的任务，通过通知推送。

**核心思路**：不硬编码规则，让 AI 自主从历史数据中发现模式。

## 旧方案 vs 新方案

| | 旧方案（硬编码） | 新方案（AI 驱动） |
|---|---|---|
| 触发规则 | "每周一9点建议周计划" | AI 从历史中自己发现周期 |
| 时间模式 | 人工定义 day_of_week + hour | AI 理解"通常在周末前规划下周" |
| 语义归一化 | 正则去除日期/数字 | AI 自然理解"2026年3月总结"="月度总结" |
| 推荐生成 | 查表 + 简单排序 | AI 综合上下文生成个性化预测 |

## 设计方案

### 核心流程

```
定时触发（每小时 / 启动时）
    ↓
收集近 N 天任务创建历史（raw data）
    ↓
发给 AI（task_history_analyzer skill）
    ↓
AI 分析后返回：
  - 发现的周期模式（"每周一早上常创建周计划类任务"）
  - 预测建议列表（title + reason）
    ↓
存储预测到 pending_predictions 表
    ↓
通过系统通知推送
    ↓
用户点击"添加" → 创建任务
用户点击"忽略" → 记录反馈
```

### 新增表：`pending_predictions`

```sql
CREATE TABLE pending_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,              -- 预测的任务标题
    reason TEXT,                      -- AI 给出的理由
    predicted_for_date TEXT,          -- 预测对应的日期 YYYY-MM-DD
    created_at TEXT,                  -- 预测生成时间
    notified_at TEXT,                 -- 通知发送时间
    status TEXT DEFAULT 'pending',   -- pending/notified/accepted/rejected/expired
    ai_context TEXT,                 -- AI 分析时的原始上下文（JSON）
    source_job_id INTEGER            -- 来源的 ai_jobs.id
);
```

### 新增表：`task_creation_history`（AI 分析用）

```sql
CREATE TABLE task_creation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_title TEXT NOT NULL,
    project_id INTEGER,
    created_at TEXT NOT NULL,        -- YYYY-MM-DD HH:MM:SS
    dow TEXT,                         -- 周几（"周一"等）
    hour INTEGER,                    -- 小时 0-23
    day_of_month INTEGER,            -- 日期 1-31
    is_recurring_instance INTEGER DEFAULT 0
);
-- 索引：(created_at), (dow, hour)
```

### 定时触发策略

**不依赖精确时间点**，而是由 Tauri 后台定时器周期性触发 AI 分析：

1. **启动时**：检查距上次分析是否超过 1 小时，超过则触发
2. **每小时**：`tauri_plugin_single_instance` 保证单实例 + `tokio::time::interval` 后台轮询
3. **不打扰用户**：分析在后台进行，预测结果通过通知推送

### AI Skill 设计

#### Skill 1：`task_history_analyzer`（分析历史，发现模式）

**触发时机**：`scheduled`（定时触发，非用户主动）

**system_prompt**：
```
你是一个用户行为分析师。分析用户的历史任务创建记录，发现时间模式和语义规律。

你的任务是：
1. 从提供的历史任务数据中，发现周期性规律
2. 识别高频任务的语义类别（如"周计划"、"月度总结"、"项目复盘"）
3. 结合当前时间上下文，预测用户今天/明天可能想创建什么任务
4. 为每个预测给出简洁的理由

规则：
- 预测要具体、可执行（如"创建本周计划"而非"做计划"）
- 关注重复性模式，而非一次性事件
- 如果历史数据不足（<7条），给出通用的今日建议
- 每组预测不超过 3 条

返回 JSON：
{
  "detected_patterns": [
    {"pattern": "每周一早上", "typical_tasks": ["周计划", "本周目标"]}
  ],
  "predictions": [
    {"title": "创建本周计划", "reason": "你每周一常规划本周工作"}
  ]
}
```

**user_prompt_template**：
```
当前时间：{{currentTime}}（{{dayOfWeek}}）

用户近 {{days}} 天创建的任务（共 {{count}} 条）：
{{taskList}}

{{#if recentProjects}}近期涉及的项目：{{recentProjects}}{{/if}}
```

#### Skill 2：`task_prediction_followup`（预测确认后执行）

当用户点击预测通知的"添加"按钮时，AI 生成完整任务创建参数（标题、描述、项目、提醒时间等）。

### 通知推送

使用 `tauri_plugin_notification`：

```
标题：📅 今日任务预测
内容：创建本周计划（你每周一常规划本周工作）
动作：
  - "添加" → 创建任务
  - "查看详情" → 打开 Dashboard 预测卡片
  - "忽略" → 24 小时内不再推送
```

### 智能去重（AI 而非规则）

**预测去重**：
- AI 收到历史后，自己判断哪些是"已有/近期创建过"的
- 不在 prompt 里写死排除列表，而是让 AI 理解"不要重复已有任务"

**反馈学习**：
- 用户忽略的预测 → 记录到 `suggestion_feedback`，AI 自动降低类似预测的权重
- 不需要硬编码"忽略后 24 小时不出现"

### 关键文件修改

| 文件 | 改动 |
|------|------|
| `src-tauri/src/db/mod.rs` | 新增 `pending_predictions`、`task_creation_history` 表 |
| `src-tauri/src/commands/prediction.rs` | 新增 Tauri commands（记录历史、查询预测、管理状态） |
| `src-tauri/src/services/prediction_scheduler.rs` | 后台定时调度服务 |
| `src-tauri/src/lib.rs` | 注册调度服务 |
| `src/services/ai/` | 新增 `task_history_analyzer` skill 定义 |
| `src/stores/predictionStore.ts` | 管理 pending_predictions 状态 |
| `src/composables/useNotification.ts` | 封装通知发送逻辑 |

### 冷启动策略

无历史数据时（< 7 条），AI 给出通用建议：
- "规划今日待办"
- "回顾本周目标"
- "整理收集箱"

### 与现有子任务建议的区别

| | 子任务建议（已有） | 任务创建预测（新） |
|---|---|---|
| 触发 | 用户打开任务详情时 | 定时/启动时后台触发 |
| 粒度 | 已有任务的子任务 | 全新任务 |
| 依据 | 当前任务标题 + 关键词 | 历史创建模式 + 时间上下文 |
| 展示 | 侧边栏 | 系统通知 + Dashboard 卡片 |

## 算法选型

既然让 AI 做大脑，算法层面只需要做好**数据收集和格式化**，具体模式发现交给 AI。

### 必须的前置工作

1. **task_creation_history 数据填充**
   - 每次 `useTaskStore.addTask()` 时，记录一行到 `task_creation_history`
   - 提取 dow/hour/day_of_month 字段（AI 分析用）
   - 排除 recurring 自动生成的任务实例（`is_recurring_instance = 0`）

2. **历史数据导出为 AI 友好格式**
   - 按时间倒序，取近 14-30 天数据
   - 格式化为 prompt 友好的文本列表

### AI 提示词工程优先

不需要实现复杂算法，重点在于：
- 设计好的 few-shot examples（让 AI 学会识别周期模式）
- 设计合理的 JSON schema（让 AI 输出可解析的预测结果）
- 反馈回路（根据用户接受/忽略率调整 prompt）

### 不采用的算法（交给 AI 处理）

- 自相关/FFT 检测周期 → AI 自然语言理解更灵活
- FP-Growth 关联规则 → AI 可发现更复杂的语义关联
- 硬编码的周月日期规则 → AI 根据实际数据推断

## 待定问题

1. 预测生成频率？（每小时 vs 每 4 小时）
2. 预测有效期？（今日有效 vs 48 小时）
3. 是否需要用户配置"只在我活跃时段推送"？
