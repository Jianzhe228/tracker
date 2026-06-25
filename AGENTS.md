# Repository Guidelines

This document provides guidelines and instructions for agentic coding agents operating in this repository.

## Project Overview

This is a **Smart Focus Tracker** desktop application built with:
- **Frontend**: Vue 3 + TypeScript + Vite + Pinia + TailwindCSS
- **Desktop**: Tauri 2 (Rust backend)
- **Charts**: ECharts
- **Testing**: Vitest + happy-dom

## Project Structure & Module Organization

```
src/                          # Vue 3 frontend
├── views/                    # Page-level Vue components (PascalCase, e.g., TimerView.vue)
├── components/               # Reusable UI components
│   └── charts/               # ECharts wrapper components
├── stores/                   # Pinia stores (camelCase with Store suffix, e.g., taskStore.ts)
├── services/
│   ├── commands/             # Tauri invoke wrappers (mirrors src-tauri/src/commands/)
│   ├── ai/                   # AI client, prompt engine, action executor
│   └── suggestion/           # Suggestion pipeline, pattern matching, learning
├── composables/              # Vue composables (useFocusModal.ts)
├── types/                    # TypeScript type definitions (domain.ts)
├── utils/                    # Utility functions (date.ts, validation.ts)
├── router/                   # Vue Router configuration
├── assets/                   # Static styles and assets
└── main.ts                   # Vue app entry point

src-tauri/                    # Tauri desktop backend (Rust)
├── src/
│   ├── commands/             # Tauri commands (task.rs, project.rs, etc.)
│   ├── db/                   # Database logic (SQLite via rusqlite)
│   ├── services/             # Business logic (webdav.rs, recurring.rs)
│   ├── lib.rs                # Command registration and app setup
│   └── main.rs               # Application entry point
├── Cargo.toml                # Rust dependencies
└── build.rs                  # Tauri build script
```

## Build, Test, and Development Commands

### Frontend Commands
```bash
npm install              # Install frontend dependencies
npm run dev              # Start Vite dev server on port 1420
npm run build            # Run vue-tsc --noEmit then build with Vite
npm run preview           # Preview production build locally
npm run typecheck         # Run TypeScript type checking only (vue-tsc --noEmit)
```

### Tauri Desktop Commands
```bash
npm run tauri:dev         # Start Tauri app in development mode
npm run tauri:build       # Build production Tauri application
./start.sh web            # Start frontend with auto npm install
./start.sh tauri debug    # Start Tauri in debug mode
./start.sh tauri release  # Build release binary and smoke test
```

### Testing Commands
```bash
# Run all tests
npx vitest

# Run tests in watch mode (re-runs on file changes)
npx vitest watch
npx vitest --watch

# Run tests once (CI mode)
npx vitest run

# Run a single test file
npx vitest run src/services/ai/__tests__/client.test.ts

# Run tests matching a pattern (filter by test name)
npx vitest run --grep "callChatCompletion"

# Run tests in a specific directory
npx vitest run src/utils/__tests__/

# Run tests with coverage (if configured)
npx vitest run --coverage
```

## Code Style & Formatting

### General Rules
- **Indentation**: 2 spaces (Tabs or 2-space equivalent)
- **Line endings**: LF (\\n)
- **Maximum line length**: 120 characters (soft guideline)
- **No trailing whitespace**
- **No unused imports** (TypeScript `verbatimModuleSyntax` enforces this)

### TypeScript Conventions

#### Imports
```typescript
// 1. Vue core imports
import { ref, computed, watch } from 'vue';

// 2. External libraries (alphabetical)
import { defineStore } from 'pinia';
import type { TaskItem, ProjectItem } from '../types/domain';

// 3. Internal services/commands (grouped by path depth)
import { listTasks as listTasksCmd } from '../services/commands/task';
import { useSettingsStore } from './settingsStore';

// 4. Utils
import { toDateKey } from '../utils/date';
```

#### Type Annotations
- Use `type` for type aliases, `interface` for object shapes
- Prefer explicit return types on public/exported functions
- Use `Record<string, unknown>` instead of `object`
- Use `Optional<T>` or `T | null | undefined` consistently

```typescript
// Good
type TaskCreateOptions = Partial<Omit<TaskItem, 'id' | 'createdAt'>>;
function createTask(payload: TaskCreateOptions): Promise<TaskItem> { ... }

// Avoid
function createTask(payload: any): Promise<any> { ... }
```

#### Vue 3 Composition API
- Use `<script setup lang="ts">` for all Vue SFCs
- Use `defineProps` and `defineEmits` with type generics
- Prefer `ref<T>()` over `reactive()` for primitives
- Use `computed()` for derived values

```typescript
<script setup lang="ts">
defineProps<{ taskId: number; title: string }>();
const emit = defineEmits<{ (e: 'update', value: string): void }>();
</script>
```

### Rust Conventions

#### Formatting
- Run `cargo fmt` before committing (2-space indentation is default)
- 2 spaces for indentation, matching TypeScript

#### Error Handling
- Use `Result<T, String>` for fallible operations (converts to `?` with `.map_err(|e| e.to_string())`)
- Return descriptive error messages, not generic "Error"
- Use `anyhow::Result` for application code, `std::result::Result` for library code

```rust
pub fn get_task(conn: &Connection, id: i64) -> Result<TaskRow, String> {
    conn.query_row(
        "SELECT * FROM tasks WHERE id = ?",
        [id],
        |row| row.try_into(),
    )
    .map_err(|e| format!("Failed to get task {}: {}", id, e))
}
```

#### Serialization
- Use `#[serde(rename_all = "camelCase")]` on all structs exchanged with frontend
- Use `#[derive(Debug, Serialize, Deserialize)]` for all serializable structs

### File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Vue Views | PascalCase | `TimerView.vue`, `SettingsView.vue` |
| Vue Components | PascalCase | `ReportModal.vue`, `FocusModal.vue` |
| Pinia Stores | camelCase + Store | `taskStore.ts`, `settingsStore.ts` |
| TypeScript Types | camelCase or domain.ts | `domain.ts`, `aiTypes.ts` |
| Composables | camelCase, verb prefix | `useFocusModal.ts`, `useECharts.ts` |
| Command Wrappers | match Rust commands | `task.ts` ↔ `task.rs` |
| Utils | camelCase | `date.ts`, `validation.ts` |
| Test Files | `*.test.ts` or `*.spec.ts` | `client.test.ts` |

## Testing Guidelines

### Frontend Tests (Vitest)
- Place test files beside the module: `src/services/ai/__tests__/client.test.ts`
- Use `describe`, `it`, `expect` globals (Vitest globals: true)
- Use `vi.fn()`, `vi.spyOn()` for mocks; `vi.restoreAllMocks()` in afterEach
- Use `happy-dom` for DOM testing
- Use `import type { ... }` for type-only imports in tests

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
```

### Rust Tests
- Use `#[cfg(test)]` module beside the code
- Use `#[test]` attribute for test functions
- Use `#[should_panic]` for expected panics

### Test File Patterns
| Pattern | Location | Use For |
|---------|----------|---------|
| `*.test.ts` | Beside source | Unit tests |
| `*.spec.ts` | Beside source | Alternative unit test naming |
| `__tests__/` | Inside module dir | Multiple test files for a module |
| `*.bench.ts` | Inside module dir | Performance benchmarks |
| `*.selftest.ts` | Inside module dir | Self-verification tests |

## Frontend/Native Boundary (Tauri)

When modifying cross-boundary features:

1. **Rust Command** (`src-tauri/src/commands/task.rs`):
   - Add struct with `#[derive(Debug, Serialize, Deserialize)]` and `#[serde(rename_all = "camelCase")]`
   - Implement handler function returning `Result<T, String>`
   - Register in `lib.rs` with `.invoke_handler(tauri::generate_handler![...])`

2. **TypeScript Wrapper** (`src/services/commands/task.ts`):
   - Create matching interface for the payload/response
   - Use `invokeCommand<T>('command_name', { payload })` pattern

3. **Store/View** (`src/stores/taskStore.ts`):
   - Import and use the TypeScript wrapper
   - Handle errors gracefully with user feedback

**Always update all three layers in the same PR.**

## Commit & Pull Request Guidelines

### Commit Message Format
```
type(scope): short summary

Examples:
feat(task): add subtask completion tracking
fix(sync): handle network timeout gracefully
refactor(ai): extract prompt templates to separate module
chore(deps): update echarts to 6.0.1
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`
Scope: `task`, `project`, `ai`, `sync`, `ui`, `db`, etc.

### Pull Request Requirements
- **Title**: Clear description of user-visible change
- **Body**:
  - Summary (2-3 bullet points)
  - Touched layers (`src/`, `src-tauri/`, `docs/`)
  - Link to issue/requirement
  - Screenshots/GIFs for UI changes
  - Commands used for verification
- **Verification**: Run `npm run build` before opening PR

## Release & Tagging Guidelines

When the user asks to tag, publish, or cut a release:
- **Always update the app version before creating the tag or GitHub Release.**
- **Use the version-bump script — do not hand-edit version numbers.** It syncs all
  files at once and verifies them, avoiding missed spots:

  ```bash
  ./bump-version.sh minor --commit --tag --push   # 2.2.0 -> 2.3.0, commit, tag v2.3.0, push both remotes
  ./bump-version.sh 2.4.0 --commit --tag --push   # explicit version
  ./bump-version.sh patch -n                       # dry-run preview, no writes
  ```

  PowerShell: `.\bump-version.ps1 minor -Commit -Tag -Push`. Accepts `major|minor|patch`
  or an explicit `X.Y.Z`. Flags: `--commit` / `--tag` / `--push` / `-n` (dry-run).
- The script keeps the release version synchronized across (current = `package.json`):
  - `package.json` (`version`)
  - `src-tauri/tauri.conf.json` (`version`)
  - `src-tauri/Cargo.toml` (`[package].version`)
  - `src-tauri/Cargo.lock` (the `tracker` package entry)
- The git tag must match the app version, using `vX.Y.Z` unless the user explicitly requests another tag format.
- Do not create a tag that points at a commit where these version files still contain the previous release version.
- GitHub Releases should be published immediately by default. Do **not** create draft releases unless the user explicitly asks for a draft.
- When using `gh release create`, omit `--draft`; prefer a normal published release and mark it latest when appropriate.

## Configuration & Secrets

### Never Commit
- Local database files (`*.db`, `*.sqlite`)
- Secrets, API keys, tokens
- Personal WebDAV/AI endpoints
- IDE-specific configs (`.idea/`, `.vscode/` unless project-wide)

### Environment Variables
- Use `.env` for local development (not committed)
- Document required env vars in `.env.example` if needed

## Lint & Typecheck

Before any PR, run:
```bash
npm run typecheck    # TypeScript type checking
npm run build        # Full build (includes typecheck + Vite build)
```

For Rust:
```bash
cargo check          # Quick compile check
cargo fmt --check    # Verify formatting
cargo clippy         # Lint warnings
cargo test           # Run tests
```

## Additional Notes

- **Strict TypeScript**: `strict: true` is enabled; avoid `any`
- **`verbatimModuleSyntax`**: Use `import type` for type-only imports
- **Vue Component Type Safety**: Use `defineProps<{...}>()` with typed props
- **Async/Await**: Always properly await async operations; handle rejections
- **Error Messages**: Show user-friendly messages, log details for debugging
