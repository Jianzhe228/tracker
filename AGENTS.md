# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Vue 3 frontend: page views in `src/views`, reusable UI in `src/components`, Pinia stores in `src/stores`, Tauri invoke wrappers in `src/services/commands`, and shared helpers in `src/utils`, `src/types`, and `src/composables`. Static styles live in `src/assets`. Native desktop code lives in `src-tauri/`: expose commands from `src-tauri/src/commands`, keep database and service logic in `src-tauri/src/db` and `src-tauri/src/services`, and register new commands in `src-tauri/src/lib.rs`. Product and schema notes live in `docs/`.

## Build, Test, and Development Commands
`npm install` installs frontend dependencies. `npm run dev` starts the Vite UI on port `1420`. `./start.sh web` does the same and auto-installs `node_modules` if needed. `npm run build` runs `vue-tsc --noEmit` and builds the web app. `npm run tauri:dev` or `./start.sh tauri debug` launches the desktop app for local testing; use `./start.sh tauri release` to smoke-test release behavior. `npm run tauri:build` packages the desktop application.

## Coding Style & Naming Conventions
Follow the existing 2-space indentation in TypeScript, Vue SFCs, and Rust. Prefer Vue 3 Composition API with `<script setup lang="ts">`. Name views and components in PascalCase, for example `TimerView.vue` and `ReportModal.vue`. Name Pinia stores in camelCase with a `Store` suffix, such as `taskStore.ts`. Keep frontend command wrappers aligned by domain with their Rust counterparts, for example `src/services/commands/task.ts` and `src-tauri/src/commands/task.rs`.

## Testing Guidelines
No dedicated Vitest, Jest, Playwright, or coverage gate is committed yet. Before opening a PR, run `npm run build`. For native or cross-layer changes, also run `npm run tauri:build` or at least `npm run tauri:dev` and smoke-test the affected flow. If you add automated tests, prefer `*.spec.ts` beside the frontend module and Rust `#[cfg(test)]` unit tests beside the backend module.

## Commit & Pull Request Guidelines
Recent history mixes concise Chinese summaries with conventional prefixes such as `feat(ai): ...` and `feat(suggestion): ...`. Prefer `type(scope): short summary` when possible. Pull requests should describe the user-visible change, list touched layers (`src/`, `src-tauri/`, `docs/`), link the issue or requirement when available, include screenshots or GIFs for UI work, and note the commands used for verification.

## Configuration & Boundary Notes
Do not commit local database artifacts, secrets, or personal WebDAV/AI endpoints. When a change crosses the frontend/native boundary, update the Rust command, the TypeScript wrapper, and any affected store or view in the same PR so the contract stays in sync.
