# AI 模块集成研究与商业化路线（2026-02-19）

## 1. 结论先行

1. **“AI + Todo/任务管理”市场已经存在，并且竞争不弱**。  
   不是“没人做”，而是“还没有把任务管理 + 专注计时 +行为闭环做深”的产品。
2. **我们可卖点不该是“有 AI”**，而应是：  
   **本地优先隐私 + 番茄与任务联动 + 可执行建议（不是聊天）+ 可量化效率提升**。
3. **当前仓库已经有 AI 基础骨架**（配置字段、`ai_logs` 表），可以直接进入“可售卖 MVP”实现阶段。

---

## 2. 市场现状（竞品快照）

| 产品 | AI 能力（公开信息） | 对我们的启发 |
|---|---|---|
| Todoist AI Assistant | 官方帮助文档已提供“任务拆解、写作辅助、邮件转任务、过滤器生成”等场景 | 纯 Todo 已经在做 AI，不做会被认为落后 |
| ClickUp Brain | 官方文档显示 Brain 可创建/更新任务；定价页写明 AI 在付费方案中已纳入（2025-04-28） | 商业化路径已被验证：AI 可作为付费差异点 |
| Sunsama AI Assist | 官方帮助中心（2025-11 更新）强调用 AI 把“任务+会议”整理成可执行日计划 | “每日计划”是高价值入口，且用户愿意为节省决策时间付费 |
| Reclaim AI | 官方页面强调“AI 任务管理、自动重排计划” | 自动排程是强需求，和番茄时段天然匹配 |
| Motion | 官网强调 AI 自动安排任务与会议，并有明显订阅定价 | 用户愿意为“自动安排时间”买单，价格天花板不低 |
| ChatGPT Tasks | OpenAI 帮助文档说明支持定时任务（网页端） | 通用 AI 正在侵入提醒/任务场景，桌面工具必须提供更强执行闭环 |

**判断**：你的直觉“要打磨才能卖”是对的；但“市场上还没有 AI Todo”这个判断在 2026 年并不成立。

---

## 3. 当前项目现状（可直接接 AI 的基础）

已具备：

1. `src/stores/settingsStore.ts` 已有 `AiSettings` 与 `updateAi`（`aiEndpoint/aiApiKey/aiModel`）。
2. `src-tauri/src/db/mod.rs` 已有 `ai_logs` 表。
3. 前后端命令边界清晰：`invoke` 封装完整，适合新增 AI commands。

缺口：

1. `src/services/ai/` 目前只有 `.gitkeep`，AI 服务未实现。
2. `src/views/SettingsView.vue` 当前标签页无“AI 设置”入口。
3. `src-tauri/src/commands/mod.rs` 与 `src-tauri/src/lib.rs` 未注册 AI command。
4. `src-tauri/src/commands/settings.rs` 将 `key/value` 直接写入 `user_settings`，API Key 仍是明文路径。

---

## 4. 建议的 AI 架构（贴合现有 Tauri + Vue）

### 4.1 设计原则

1. **AI 只做“建议与决策支持”**，最终写入必须可确认。
2. **结构化输出优先**，避免自然语言解析不稳定。
3. **先做窄场景高频价值**，避免一开始做“大而全 AI 助手”。

### 4.2 模块分层

1. **Trigger Engine（前端 + 本地规则）**  
   例如：任务输入防抖、拖延阈值触发、每日首次打开触发。
2. **Context Builder（Rust）**  
   从 SQLite 聚合最小必要上下文（最近任务、专注统计、规则偏好）。
3. **AI Gateway（Rust）**  
   统一 provider 适配（OpenAI 兼容优先），处理超时、重试、配额、审计日志。
4. **Action Executor（前端 Store）**  
   把结构化建议映射成 `taskStore` 可执行操作（填表、拆分、批量创建）。

### 4.3 与当前代码的落点

1. 新增 `src-tauri/src/commands/ai.rs`
2. 新增 `src-tauri/src/services/ai_gateway.rs`
3. 在 `src-tauri/src/commands/mod.rs` 与 `src-tauri/src/lib.rs` 注册命令
4. 新增 `src/services/commands/ai.ts` 与 `src/services/ai/*`
5. 在 `src/views/SettingsView.vue` 增加 AI 标签页并接 `settingsStore.updateAi`

---

## 5. MVP 功能优先级（先卖得出去）

### P1（必须）

1. **任务创建建议（输入框补全 + 结构化建议）**
   - 输入 3 字符、500ms 防抖、3 秒超时静默失败
   - 输出字段：描述、标签、番茄估时、建议理由
2. **每日计划建议（今天要做什么）**
   - 以“今日可完成”为目标，给出可勾选计划与时间块建议
3. **AI 使用上限与预算保护**
   - 每分钟/每小时/每月限额（与需求文档一致）
   - 设置页展示用量与剩余额度

### P2（增强）

1. **拖延任务自动拆分建议**
2. **效率下降洞察卡片**
3. **周报/月报（可复制导出）**

---

## 6. 安全与合规（商业化必须做）

1. **API Key 不落明文 SQLite**  
   Tauri Store 插件文档明确提示“默认不加密”，不适合存密钥。建议使用系统密钥链或 Stronghold。
2. **最小网络权限**  
   用 Tauri capability/http scope 仅放行 AI 域名（如自定义 endpoint 白名单）。
3. **数据最小化上传**  
   默认不上传完整任务历史，只传必要字段；设置中提供“隐私级别”。
4. **可审计**  
   `ai_logs` 增加 `model/latency_ms/tokens/status/cost_estimate`，支持后续成本分析和问题追踪。

---

## 7. 成本与商业化建议

1. **双模式**：  
   - BYOK（用户自带 Key，降低我们成本）  
   - 托管额度（内置模型调用，按月度额度售卖）
2. **套餐建议**：  
   - Basic：无 AI 或低频 AI  
   - Pro：完整 AI 场景 + 报告 + 自动计划
3. **关键北极星指标**：  
   - AI 建议采纳率  
   - 建议后 7 日任务完成率提升  
   - 人均日计划耗时下降（分钟）

---

## 8. 两周可执行路线

### 第 1 周：基础可用

1. 完成 AI 设置页（endpoint/key/model/test）
2. 落地 AI command + gateway + 超时/限流
3. 任务创建建议打通（结构化返回 + 一键应用）

### 第 2 周：可售卖闭环

1. 每日计划建议（勾选应用）
2. 使用量看板 + 月度限额
3. 失败降级策略与日志完善

---

## 9. 外部资料（调研来源）

1. Todoist AI Assistant（官方帮助）：https://todoist.com/zh-CN/help/articles/what-is-the-ai-assistant-YTg8N3x2p  
2. ClickUp Brain（官方帮助）：https://help.clickup.com/hc/en-us/articles/6327739849111-Intro-to-ClickUp-Brain  
3. ClickUp Pricing（官方，含 AI 说明与日期）：https://clickup.com/pricing  
4. Sunsama AI Assist（官方帮助，2025-11 更新）：https://help.sunsama.com/en/articles/10742572-ai-assist-setting-up-your-week  
5. Reclaim AI Task Management（官方）：https://reclaim.ai/features/ai-task-management  
6. Motion Pricing（官方）：https://www.usemotion.com/pricing  
7. OpenAI ChatGPT Tasks（官方帮助）：https://help.openai.com/en/articles/10291617-tasks-in-chatgpt  
8. OpenAI Function Calling：https://platform.openai.com/docs/guides/function-calling  
9. OpenAI Structured Outputs：https://platform.openai.com/docs/guides/structured-outputs  
10. OpenAI Prompt Caching：https://platform.openai.com/docs/guides/prompt-caching  
11. OpenAI Data Controls（API 数据控制）：https://platform.openai.com/docs/guides/your-data  
12. Tauri Plugin Store（默认不加密提示）：https://v2.tauri.app/plugin/store/  
13. Tauri Plugin Stronghold（加密存储）：https://v2.tauri.app/plugin/stronghold/  
14. Tauri Security（能力边界）：https://v2.tauri.app/learn/security/  
15. Tauri HTTP Plugin + Scope：https://v2.tauri.app/plugin/http-client/ 、https://v2.tauri.app/plugin/http-client/#scope

