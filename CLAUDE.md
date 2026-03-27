# CLAUDE.md

## 工作方式

- 多使用 subagent 并行处理独立任务，提高效率。能并行的工作不要串行执行。

## Project Overview

Smart Focus Tracker — Tauri 2 + Vue 3 桌面端任务管理应用，集成番茄钟、专注统计和 AI 辅助任务分解。

## Tech Stack

- **Frontend**: Vue 3 + TypeScript + Pinia + Tailwind CSS
- **Backend**: Rust (Tauri 2) + rusqlite
- **Database**: SQLite (WAL mode, tracker.db in app data directory)
- **AI**: OpenAI-compatible API (用户自配 endpoint/key/model)
- **Charts**: ECharts (via vue-echarts)

## 常用命令

```bash
# 前端开发
npm run dev              # Web 开发模式（Vite）
npm run build            # 生产构建
npm run typecheck        # TypeScript 类型检查

# Tauri 桌面应用
npm run tauri:dev        # Tauri 开发模式（热重载 Rust + Web）
npm run tauri:build       # Tauri 生产构建

# 测试（vitest，无 npm script，直接调用）
npx vitest run           # 运行所有测试
npx vitest run src/services/ai/client.test.ts  # 运行单个测试文件

# Linux 桌面依赖（开发前需安装）
pkexec apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

## Core Design Principles

### 1. 本地优先，AI 保底
本地数据（模式库、学习历史、手动子任务历史）始终优先于 AI 建议。AI 仅在本地数据置信度不足时作为 fallback。置信度通过 `confidenceScorer.ts` 计算。

### 2. 从行为学习，不靠配置
系统通过观察用户行为自动学习：手动创建子任务（权重最高 +2）、接受 AI 建议 (+1)、拒绝建议 (-1)。不要求用户手动配置规则或模板。

### 3. 不做领域假设
AI prompt、关键词提取、建议逻辑不假设特定任务类型。关键词提取使用通用 n-gram 方式，不依赖硬编码词典。AI prompt 让模型根据任务标题和上下文推断任务类型。

### 4. 置信度门控 AI 调用
- score >= 0.7 → 仅用本地数据（不调 AI）
- 0.3-0.7 → 混合（本地即时展示 + AI 后台补充）
- < 0.3 → AI 保底（传入完整上下文）

### 5. 丰富上下文 > 巧妙 prompt
调 AI 时提供最大上下文：用户历史模式、已接受建议、已拒绝建议（告知 AI 避免）、手动子任务历史、项目内其他任务。

### 6. 数据持久化
所有学习数据经 SQLite 持久化。关键表：`subtask_learn_log`、`suggestion_feedback`、`task_subtask_history`、`subtask_patterns`、`keyword_clusters`。

### 7. 不写兼容代码
项目初期，需要修改时直接重构，不写兼容层或迁移兼容代码。

## Architecture Conventions

### Frontend (Vue/TypeScript)
- 所有 DB 操作通过 Tauri command，不直接访问 SQLite
- Pinia stores 管理状态，services 管理业务逻辑
- `src/services/commands/*.ts` 是 Tauri `invoke()` 的前端封装（调用 Rust 命令）
- `src/services/suggestion/` 管理建议管线（keyword → confidence → pattern/learning/AI）
- `src/services/ai/` 管理 AI 调度（queue、prompt、client、actionExecutor）

### Backend (Rust)
- `src-tauri/src/commands/` 暴露 Tauri commands（Rust 实现）
- `src-tauri/src/db/mod.rs` 管理 schema + migrations
- Migrations 使用 `PRAGMA user_version` 顺序递增
- 当前 schema version: v15

### Database Key Tables
- `tasks` — 任务 CRUD（软删除）
- `subtask_patterns` — 模式模板库
- `subtask_learn_log` — 用户行为学习日志（keyword → subtask 关联 + 分数）
- `suggestion_feedback` — 建议接受/拒绝记录
- `task_subtask_history` — 任务完成时子任务快照
- `keyword_clusters` — 关键词语义聚类
- `ai_skills` — AI 技能定义（prompt 模板存于表中，不硬编码）
- `ai_jobs` — AI 任务队列

### AI Integration
- AI prompts 存储在 `ai_skills` 表中，通过 `promptEngine.ts` 渲染模板变量
- AI 始终可选——核心功能无需 API key 即可工作
- AI 结果经过 approve/reject 工作流（aiStore）
- 用户反馈自动回流到学习引擎，持续改善建议质量
