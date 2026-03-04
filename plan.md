# 子任务智能建议系统 — 实施计划

## 目标

替换当前纯 AI 子任务生成方案，改为三层架构：**模式模板库 → 用户行为学习 → AI 增强**。

核心价值：减少 AI 依赖、提升建议个性化、保证离线可用、不同 AI 模型体验一致。

---

## 第一层：模式模板库（Pattern Library）

### 数据库 — migration v10

新增 `subtask_patterns` 表：

```sql
CREATE TABLE IF NOT EXISTS subtask_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                    -- 模板名称，如"健身"
    keywords TEXT NOT NULL DEFAULT '[]',   -- JSON数组：匹配关键词 ["健身","锻炼","gym"]
    subtasks TEXT NOT NULL DEFAULT '[]',   -- JSON数组：子任务模板 ["水杯","运动鞋","手表"]
    project_id INTEGER,                    -- 可选：绑定到某个项目
    is_builtin INTEGER NOT NULL DEFAULT 0, -- 内置 vs 用户创建
    usage_count INTEGER DEFAULT 0,         -- 被命中使用的次数
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
```

内置种子数据（5-8 个常见场景）：
- 健身/运动 → ["运动装备","水杯","毛巾"]
- 出差/出行 → ["证件","充电器","换洗衣物"]
- 面试 → ["简历","公司调研","着装准备"]
- 搬家 → ["打包材料","联系搬家公司","断水断电"]
- 出门/外出 → ["手机","钥匙","钱包"]

### Rust 命令

新建 `src-tauri/src/commands/pattern.rs`：
- `pattern_list` — 列出所有模板（支持按 project_id 过滤）
- `pattern_create` — 创建模板
- `pattern_update` — 更新模板
- `pattern_delete` — 删除模板
- `pattern_match` — 根据任务标题匹配模板（Rust 侧做关键词匹配，返回匹配到的模板列表）

注册到 `lib.rs` 的 `generate_handler![]` 和 `commands/mod.rs`。

### 前端命令包装

新建 `src/services/commands/pattern.ts`：封装上述 5 个 invoke 调用。

### 设置页 UI — 新增"子任务模板"tab

在 `SettingsView.vue` 的 `activeTab` 类型中加入 `'patterns'`，导航栏加入"子任务模板"选项。

模板管理界面：
- 模板列表（卡片形式），显示名称、关键词标签、子任务列表
- 新增模板按钮 → 弹出编辑表单（名称、关键词、子任务列表、可选绑定项目）
- 每个模板支持编辑/删除
- 内置模板标记"系统"标签，不可删除但可编辑

---

## 第二层：用户行为学习（Local Learning）

### 数据库 — migration v10（同批）

```sql
-- 子任务采纳/拒绝记录（用于学习）
CREATE TABLE IF NOT EXISTS subtask_learn_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id INTEGER,                    -- 关联的关键词簇
    project_id INTEGER,                    -- 任务所属项目
    keyword TEXT NOT NULL,                 -- 从父任务提取的关键词
    subtask_title TEXT NOT NULL,           -- 子任务标题
    score INTEGER NOT NULL DEFAULT 1,      -- 采纳+1，拒绝-1
    source TEXT DEFAULT 'user',            -- 'user'|'ai'|'template'
    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_subtask_learn_keyword ON subtask_learn_log(keyword);
CREATE INDEX IF NOT EXISTS idx_subtask_learn_project ON subtask_learn_log(project_id);

-- 关键词聚类（AI 辅助确认）
CREATE TABLE IF NOT EXISTS keyword_clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                    -- 簇名称，如"运动健身"
    keywords TEXT NOT NULL DEFAULT '[]',   -- JSON数组：聚合的关键词
    confirmed INTEGER NOT NULL DEFAULT 0,  -- 0=自动聚类，1=AI确认，2=用户确认
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Rust 命令

新建 `src-tauri/src/commands/learning.rs`：
- `learn_record` — 记录一条采纳/拒绝（upsert: keyword+subtask_title 组合存在则更新 score）
- `learn_suggest` — 根据关键词列表 + project_id 查询高频子任务（score > 0, 按 score 降序，取 top N）
- `cluster_list` — 列出所有关键词簇
- `cluster_upsert` — 创建或更新簇
- `cluster_delete` — 删除簇

### 前端学习引擎

新建 `src/services/suggestion/` 目录：

**`keywordExtractor.ts`** — 从任务标题提取关键词：
- 中文：基于词典的简单分词（内置高频词典 200-300 词：运动、健身、出差、会议、面试……）+ 去停用词（的、了、去、要、在、等下……）
- 英文：空格分词 + 去停用词
- 返回 `string[]` 关键词列表

**`patternMatcher.ts`** — 模板匹配：
- 调用 Rust `pattern_match` 或前端侧匹配（关键词交集 ≥ 1 即命中）
- 优先匹配 project_id 绑定的模板，其次匹配全局模板
- 返回匹配到的模板及其子任务列表

**`learningEngine.ts`** — 行为学习推荐：
- 先查 `keyword_clusters` 扩展关键词（如 "跑步" 扩展到 ["跑步","运动","健身"]）
- 用扩展后的关键词 + project_id 查 `subtask_learn_log`
- 按 score 降序排列，过滤 score ≤ 0 的，取 top 5
- 返回建议列表

**`suggestionPipeline.ts`** — 三层编排：
```
输入: taskTitle, projectId
  ↓
1. keywordExtractor.extract(taskTitle) → keywords[]
2. patternMatcher.match(keywords, projectId)
   → 有结果? 返回 {source: 'pattern', suggestions: [...]}
3. learningEngine.suggest(keywords, projectId)
   → 有结果(≥2条)? 返回 {source: 'learning', suggestions: [...]}
4. AI 开启? → 调用增强版 AI（第三层）
   → 返回 {source: 'ai', suggestions: [...]}
5. 无结果 → 返回 {source: 'none', suggestions: []}
```

### 反馈闭环

在任务创建后显示建议时：
- 用户"确认"某个子任务 → 调用 `learn_record(keyword, subtask_title, +1)`
- 用户"拒绝"某个子任务 → 调用 `learn_record(keyword, subtask_title, -1)`
- 用户手动添加子任务 → 也记录到学习日志（source='user'）

现有的 `NotificationCenter.vue` 中 AI 待确认面板的 approve/reject 操作也需要接入学习反馈。

---

## 第三层：AI 增强（改造现有 prompt）

### Prompt 改造

修改 `task_decompose` skill 的 system prompt 和 user prompt template（migration v10 UPDATE）：

**新 system_prompt：**
```
You are a concise task checklist assistant. Your job is to suggest only the KEY items
the user needs to prepare or check — like a quick packing list, NOT a project plan.

Rules:
- Max 3-4 items for simple tasks, max 5-6 for complex tasks
- Each item should be a noun or short noun phrase (e.g. "水杯", "充电器", "简历打印")
- Do NOT suggest obvious/generic steps like "确认时间", "规划路线", "检查天气"
- Do NOT suggest meta-tasks like "制定计划", "总结复盘"
- Think like a real person: what would they actually forget or need to check?
- Use the same language as the task title

If user patterns are provided, prioritize items consistent with their history.

Return JSON only: {"actions": [{"type": "create_subtask", "params": {"title": "..."}}]}
```

**新 user_prompt_template：**
```
Task: {{taskTitle}}
Project: {{projectName}}
{{#if userPatterns}}
User's usual checklist for similar tasks: {{userPatterns}}
{{/if}}
{{#if learnedItems}}
Previously adopted items: {{learnedItems}}
{{/if}}
```

### AI 调用时注入用户上下文

修改 `TasksView.vue` 中 `submitJob` 调用，在 `inputContext` 中增加：
- `projectName`: 当前项目名
- `userPatterns`: 从模板库匹配到的子任务列表（如果有）
- `learnedItems`: 从学习引擎获取的高频子任务（如果有）

这样 AI 在前两层都无完整结果时，仍然可以参考部分用户偏好数据来生成更个性化的建议。

### 关键词聚类 + AI 确认

新增一个后台定时任务（或手动触发）：
- 遍历 `subtask_learn_log` 中所有 keyword
- 用 Jaccard 相似度 / 共现频率做初步聚类
- 将聚类结果通过 AI 确认（新建一个 `keyword_cluster_confirm` skill）：
  - 发送："以下关键词是否属于同一类？请确认并给出类名：['跑步','健身','锻炼','运动']"
  - AI 返回确认结果
- 写入 `keyword_clusters` 表，`confirmed = 1`

这个功能可以在设置页手动触发（"重新分析关键词"按钮），不阻塞主流程。

---

## 任务创建流程改造

### 当前流程
```
用户输入标题 → addTask → fire-and-forget AI job → 通知中心显示待确认
```

### 新流程
```
用户输入标题 → addTask
  → suggestionPipeline.suggest(title, projectId)
    → 模板匹配 / 学习推荐: 即时返回建议（<50ms）
    → 或 AI 异步返回
  → 任务详情区显示建议（inline，非通知中心）
  → 用户确认/拒绝每条建议
  → 反馈写入学习日志
```

建议展示位置：在 `TasksView.vue` 的任务详情面板中，子任务列表上方增加"建议"区域，而不是放在通知中心。通知中心仍保留 AI 异步结果的展示，但模板和学习建议应该 inline 展示。

---

## 文件变更清单

### 新增文件
| 文件 | 说明 |
|------|------|
| `src-tauri/src/commands/pattern.rs` | 模板 CRUD + 匹配命令 |
| `src-tauri/src/commands/learning.rs` | 学习记录 + 建议查询 + 聚类命令 |
| `src/services/commands/pattern.ts` | 模板命令前端封装 |
| `src/services/commands/learning.ts` | 学习命令前端封装 |
| `src/services/suggestion/keywordExtractor.ts` | 关键词提取 |
| `src/services/suggestion/patternMatcher.ts` | 模板匹配 |
| `src/services/suggestion/learningEngine.ts` | 学习推荐 |
| `src/services/suggestion/suggestionPipeline.ts` | 三层编排 |
| `src/services/suggestion/index.ts` | 导出 |

### 修改文件
| 文件 | 变更 |
|------|------|
| `src-tauri/src/db/mod.rs` | 新增 migration v10（3 张表 + seed 数据 + prompt 更新） |
| `src-tauri/src/commands/mod.rs` | 注册 pattern、learning 模块 |
| `src-tauri/src/lib.rs` | generate_handler 注册新命令 |
| `src/views/SettingsView.vue` | 新增"子任务模板"tab + UI |
| `src/views/TasksView.vue` | 集成 suggestionPipeline、inline 建议展示、反馈闭环 |
| `src/components/NotificationCenter.vue` | approve/reject 接入学习反馈 |
| `src/types/domain.ts` | 新增 SubtaskPattern、LearnRecord、KeywordCluster 类型 |

---

## 实施顺序

1. **数据库 + Rust 命令**：migration v10 + pattern.rs + learning.rs
2. **前端命令封装 + 类型**：pattern.ts + learning.ts + domain.ts
3. **建议引擎**：suggestion/ 目录全部文件
4. **设置页模板管理 UI**：SettingsView.vue 新 tab
5. **任务创建流程集成**：TasksView.vue 建议展示 + 反馈
6. **AI prompt 改造**：migration 中更新 + queue.ts 注入上下文
7. **关键词聚类**：后台聚类逻辑 + AI 确认 skill
