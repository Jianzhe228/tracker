# 代码审查报告 (2026-03-27)

## 审查范围
- 前端: Vue 3 + TypeScript + Pinia + Tailwind CSS
- 后端: Rust (Tauri 2) + rusqlite
- AI 系统: 建议管线、学习引擎、AI 调度

---

## P0 - 立即修复 (数据一致性和严重 Bug)

### 1. `focus_session_create` segments 无事务 ⚠️
**文件**: `src-tauri/src/commands/focus_session.rs:108-117`

session 插入成功后，segments 循环插入如果中途失败，session 已创建但 segments 不完整。

```rust
// 问题代码
conn.execute("INSERT INTO focus_sessions ...", ...)?;
for seg in segments {
    conn.execute("INSERT INTO focus_session_segments ...", ...)?;  // 失败时无回滚
}
```

**修复**: 包装在 `db.transaction()` 中。

---

### 2. `project_delete` 无事务保护 ⚠️
**文件**: `src-tauri/src/commands/project.rs:136-156`

先移动任务再删除项目，两步之间失败导致状态不一致。

```rust
// 问题代码
db.execute("UPDATE tasks SET project_id = 1 ...", ...)?;  // 任务已移动
if id == 1 { return Err(...); }  // 检查在移动之后
db.execute("DELETE FROM projects ...", ...)?;  // 如果这步失败，任务已移动但项目未删
```

**修复**: 使用事务包裹所有操作。

---

### 3. `removeProject` 响应式失效 ⚠️
**文件**: `src/stores/taskStore.ts:531-542`

直接修改 `task.projectId = 1` 不触发响应式，因为数组引用没变。

```typescript
// 问题代码
for (const task of tasks.value) {
  if (task.projectId === id) {
    task.projectId = 1;  // 不触发响应式，UI 不更新
  }
}

// 正确做法
tasks.value = tasks.value.map(task =>
  task.projectId === id ? { ...task, projectId: 1 } : task
);
```

---

### 4. Migration 使用 `panic` 代替错误处理 ⚠️
**文件**: `src-tauri/src/db/mod.rs` 多处 `expect()`

数据库初始化失败时直接 panic，应用无法启动。

```rust
// 问题代码
std::fs::create_dir_all(&app_dir)
    .expect("FATAL: cannot create app data dir");

Connection::open(&db_path)
    .unwrap_or_else(|e| panic!("FATAL: cannot open database"));

conn.execute_batch("PRAGMA foreign_keys=ON;")
    .expect("FATAL: cannot enable foreign keys");
```

**修复**: 返回 `Result` 并在上层优雅处理。

---

### 5. `useFocusModal` 全局单例问题 ⚠️
**文件**: `src/composables/useFocusModal.ts:3`

模块级 `visible` ref 被所有组件共享，多实例时会冲突。

```typescript
// 问题代码
const visible = ref(false);  // 模块级单例

export function useFocusModal() {
  return { visible, open, close };  // 所有调用者共享同一个 visible
}
```

**修复**: 将 `visible` 移到函数内部返回。

---

### 6. `timerStore` 构造时副作用 ⚠️
**文件**: `src/stores/timerStore.ts:785`

`hydrateFromStorage()` 在 store 定义时立即执行，测试困难且可能导致页面加载时弹出确认对话框。

```typescript
// 问题代码
export const useTimerStore = defineStore('timer', () => {
  hydrateFromStorage();  // 立即执行！副作用在构造时发生
  // ...
});
```

**修复**: 移除自动调用，在 App.vue 的 `onMounted` 中显式调用。

---

## P1 - 短期修复 (性能和健壮性)

### 7. `cleanup_expired_soft_deleted_tasks` 索引失效
**文件**: `src-tauri/src/commands/task.rs:81-87`

`julianday()` 函数导致无法使用 `idx_tasks_deleted_at` 索引。

```sql
-- 问题: 无法使用索引
DELETE FROM tasks
WHERE deleted_at IS NOT NULL
  AND julianday(deleted_at) <= julianday('now') - (10.0 / 86400.0)

-- 正确: 使用范围查询
DELETE FROM tasks
WHERE deleted_at IS NOT NULL
  AND deleted_at <= datetime('now', '-10 seconds')
```

---

### 8. `cleanup_expired_soft_deleted_tasks` 频繁调用
**文件**: `src-tauri/src/commands/task.rs`

在 `task_list`、`task_create`、`task_update`、`task_delete`、`task_restore` 每次都调用，对大表是 O(n) 全表扫描。

**修复**: 改为只在 `task_delete` 时调用，或使用定时任务。

---

### 9. `generate_recurring_tasks` N+1 查询
**文件**: `src-tauri/src/services/recurring.rs:137-164`

每个 rule 循环内执行一次 SELECT 检查 + 可能 INSERT。

**修复**: 批量查询所有 rule 的已有任务，内存中过滤后批量 INSERT。

---

### 10. `learn_record_batch` N+1 查询
**文件**: `src-tauri/src/commands/learning.rs:155-180`

每个 keyword 执行一次 SELECT + UPDATE/INSERT。

**修复**: 使用单个 SQL + CTE 批量处理。

---

### 11. `app_init` 无分页全量加载
**文件**: `src-tauri/src/commands/init.rs:30-64`

启动时加载所有数据到内存，大数据集时阻塞主线程。

**修复**: 实现分页加载或 cursor-based pagination。

---

### 12. `aiStore` pollInterval 无清理
**文件**: `src/stores/aiStore.ts:44-48`

interval 创建后从不清理，store 重建时会累积。

```typescript
// 问题代码
pollInterval = setInterval(() => {
  processingCount.value = getProcessingCount();
  void loadPendingJobs();
}, 10_000);
// 缺少 clearInterval
```

**修复**: 添加 `dispose()` 方法在组件卸载时调用。

---

### 13. `useSuggestionPanel` 内存泄漏
**文件**: `src/composables/useSuggestionPanel.ts:60`

panels Map 只增不减，访问过的 task panel 永远留在内存中。

```typescript
// 问题代码
const panels: ShallowRef<Map<number, SuggestionPanelState>> = shallowRef(new Map());
// panels.value.set(taskId, state) - 只有添加，没有删除
```

**修复**: 添加 `removePanel(taskId)` 方法，在 unmount 时调用清理。

---

### 14. `acceptAll` 顺序执行
**文件**: `src/composables/useSuggestionPanel.ts:274-283`

`for...await` 顺序执行，100 个建议需要串行等待。

```typescript
// 问题代码
for (const item of items) {
  await acceptSuggestion(taskId, item);  // 串行
}

// 正确做法
await Promise.all(items.map(item => acceptSuggestion(taskId, item)));
```

---

### 15. `queue.ts` 并发竞态条件
**文件**: `src/services/ai/queue.ts:44-47`

多个 `enqueue()` 同时调用时，多个 `processQueue()` 可能同时运行。

```typescript
// 问题代码
async function processQueue(): Promise<void> {
  if (processing) return;  // 非原子检查
  processing = true;
  // ...
}
```

**修复**: 使用 mutex 或 Atomics 确保只有一个 processQueue 运行。

---

### 16. `siblingTasks` 永久为空
**文件**: `src/services/suggestion/suggestionPipeline.ts:115`

`buildAiContext` 中 siblingTasks 是 TODO，AI 永远收不到同项目其他任务的上下文。

```typescript
// 问题代码
const siblingTasks = ''; // TODO: query sibling tasks from task store
```

**修复**: 实现查询同 project 其他任务的逻辑。

---

### 17. 失败任务静默返回 `null`
**文件**: `src/services/ai/queue.ts:53-56`

job 失败时返回 `null`，调用方无法区分失败和空结果。

```typescript
// 问题代码
} catch (e) {
  console.error('[ai-queue] job failed', e);
  item.resolve(null);  // 调用方无法知道是失败还是真的无结果
}
```

**修复**: 返回带错误信息的对象，或使用 Promise.reject。

---

### 18. `learn_suggest` 与 `learn_stats` 关键词扩展不一致
**文件**: `src-tauri/src/commands/learning.rs`

- `learn_suggest`: cluster 扩展 + fuzzy 扩展
- `learn_stats`: 只有 fuzzy 扩展

导致置信度计算和实际建议使用的关键词集合不同。

**修复**: 统一使用相同的扩展逻辑。

---

## P2 - 中期优化

### 19. `progress` countup baseline 错误
**文件**: `src/stores/timerStore.ts:147-154`

countup 模式下使用 `getDefaultSeconds('focus')` 而非 `totalSeconds`。

```typescript
// 问题代码
const baseline = Math.max(60, getDefaultSeconds('focus'));  // 默认 25min

// 正确做法
const baseline = Math.max(60, totalSeconds.value);
```

---

### 20. `finalizeFocusSession` 番茄数计算用硬编码值
**文件**: `src/stores/timerStore.ts:483-490`

使用 `getDefaultSeconds('focus')` 而非用户配置的 `settingsStore.pomodoro.focusMinutes`。

---

### 21. `ReportModal` 硬编码数据
**文件**: `src/components/ReportModal.vue`

所有统计数据都是硬编码的 0，无数据绑定。

---

### 22. `Cluster JSON LIKE` 匹配错误
**文件**: `src-tauri/src/commands/learning.rs:209`

使用 `LIKE '%"keyword'%` 匹配 JSON 数组，假阳性风险。

```rust
// 问题: "六" 会匹配到 "四六级"
let pattern = format!("%\"{}%", kw);
```

**修复**: 使用 JSON 函数的 exact match 或修改 schema。

---

### 23. 快速连击无保护
**文件**: `src/stores/taskStore.ts:188-287`

`toggleTask` 无 loading 锁或 debounce，快速连击可能导致竞态。

---

## 修复优先级

```
Phase 1 (P0): 数据一致性
├─ 1.1 focus_session_create 事务
├─ 1.2 project_delete 事务
├─ 1.3 removeProject 响应式
└─ 1.4 Migration 错误处理

Phase 2 (P1): 性能
├─ 2.1 cleanup 使用索引
├─ 2.2 减少 cleanup 调用频率
├─ 2.3 generate_recurring 批量
└─ 2.4 learn_record_batch 批量

Phase 3 (P1): 内存管理
├─ 3.1 aiStore 清理
├─ 3.2 panels 清理
└─ 3.3 timerStore 显式初始化

Phase 4 (P1): UI
├─ 4.1 useFocusModal 单例
└─ 4.2 acceptAll 并行

Phase 5 (P1): AI 健壮性
├─ 5.1 queue 竞态
├─ 5.2 siblingTasks 实现
└─ 5.3 关键词扩展统一
```
