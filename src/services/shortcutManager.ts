import type { Router } from 'vue-router';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { nextTick } from 'vue';
import type { ShortcutBinding, ShortcutAction, ShortcutModifier } from '../types/domain';
import type { useTimerStore } from '../stores/timerStore';

// ── Default shortcuts ──────────────────────────────────────────────────

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  {
    id: 'new_task',
    label: '新任务',
    key: 'n',
    modifiers: ['ctrl'],
    mode: 'inapp',
    enabled: true,
    action: 'focus_new_task',
  },
  {
    id: 'search',
    label: '搜索任务',
    key: 'f',
    modifiers: ['ctrl'],
    mode: 'inapp',
    enabled: true,
    action: 'focus_search',
  },
  {
    id: 'settings',
    label: '打开设置',
    key: ',',
    modifiers: ['ctrl'],
    mode: 'inapp',
    enabled: true,
    action: 'open_settings',
  },
  {
    id: 'toggle_timer',
    label: '开始/暂停番茄钟',
    key: 'Space',
    modifiers: [],
    mode: 'inapp',
    enabled: true,
    action: 'toggle_timer',
  },
];

// ── Platform detection ─────────────────────────────────────────────────

let _platformCache: 'mac' | 'other' | null = null;

export function detectPlatform(): 'mac' | 'other' {
  if (_platformCache) return _platformCache;
  _platformCache = navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other';
  return _platformCache;
}

// ── Editable target check ──────────────────────────────────────────────

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest('input, textarea, select, button, a, [contenteditable="true"]') != null
  );
}

// ── Key matching ───────────────────────────────────────────────────────

export function matchesBinding(
  event: KeyboardEvent,
  binding: ShortcutBinding,
  platform: 'mac' | 'other',
): boolean {
  if (!binding.enabled) return false;

  // Determine the effective ctrl modifier based on platform
  const ctrlPressed = platform === 'mac' ? event.metaKey : event.ctrlKey;

  // Build a map of which modifiers are pressed
  const pressed: Record<ShortcutModifier, boolean> = {
    ctrl: ctrlPressed,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };

  // For macOS: 'ctrl' in config maps to metaKey (Cmd).
  // We must NOT also count meta as a separate modifier when it already served as ctrl.
  // On Windows/Linux: metaKey = Windows key, which is independent of ctrl.
  const configModifierSet = new Set(binding.modifiers);

  for (const mod of ['ctrl', 'alt', 'shift', 'meta'] as const) {
    const expected = configModifierSet.has(mod);
    // On macOS, 'ctrl' in config means meta (Cmd), so we skip the raw ctrlKey check.
    // On macOS, 'meta' in config would mean the raw metaKey — but Cmd is ctrl, so
    // we treat 'meta' as the Windows key.  For now, just compare directly.
    if (platform === 'mac' && mod === 'ctrl') {
      // Already handled via ctrlPressed = event.metaKey above
      if (pressed.ctrl !== expected) return false;
    } else if (platform === 'mac' && mod === 'meta') {
      // On macOS, raw metaKey would be Cmd which is already mapped to 'ctrl'.
      // If someone explicitly adds 'meta', treat it as the same as 'ctrl' (Cmd).
      if (pressed.meta !== expected) return false;
    } else {
      if (pressed[mod] !== expected) return false;
    }
  }

  // Ensure no extra modifiers beyond what's configured
  let pressedModCount = 0;
  if (ctrlPressed) pressedModCount++;
  if (event.altKey) pressedModCount++;
  if (event.shiftKey) pressedModCount++;
  if (event.metaKey) pressedModCount++;

  // On macOS, ctrl and meta could be the same key (Cmd), so they count as 1
  if (platform === 'mac' && ctrlPressed && event.metaKey) {
    pressedModCount--; // de-duplicate Cmd
  }

  if (pressedModCount !== binding.modifiers.length) return false;

  // Match the content key
  const bindingKey = binding.key.toLowerCase();
  if (bindingKey === 'space') {
    if (event.code !== 'Space') return false;
  } else if (bindingKey.length === 1) {
    // Single character — compare event.key (lowercase)
    if (event.key.toLowerCase() !== bindingKey) return false;
  } else {
    // Multi-character key (ArrowUp, F1, etc.) — compare event.key (case-insensitive)
    if (event.key.toLowerCase() !== bindingKey.toLowerCase()) return false;
  }

  return true;
}

// ── Action execution ───────────────────────────────────────────────────

export interface ActionContext {
  router: Router;
  timerStore: ReturnType<typeof useTimerStore>;
  focusModal: { open: () => void };
  route: RouteLocationNormalizedLoaded;
}

function isTaskRoute(route: RouteLocationNormalizedLoaded): boolean {
  const name = String(route.name || '');
  return name === 'today' || name === 'all' || name === 'project';
}

export async function executeAction(
  action: ShortcutAction,
  context: ActionContext,
): Promise<void> {
  const { router, timerStore, focusModal, route } = context;

  switch (action) {
    case 'focus_new_task': {
      if (!isTaskRoute(route) || route.name === 'all') {
        await router.push('/tasks/today');
      }
      await nextTick();
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('tracker:focus-new-task'));
      }, 0);
      break;
    }
    case 'focus_search': {
      if (route.name !== 'all') {
        await router.push('/tasks/all');
      }
      await nextTick();
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('tracker:focus-task-search'));
      }, 0);
      break;
    }
    case 'open_settings': {
      await router.push('/settings');
      break;
    }
    case 'toggle_timer': {
      if (timerStore.running) {
        timerStore.pause();
      } else if (timerStore.paused) {
        timerStore.resume();
      } else {
        timerStore.start();
        focusModal.open();
      }
      break;
    }
  }
}

// ── In-app keydown handler ─────────────────────────────────────────────

export function createInAppKeydownHandler(
  bindings: ShortcutBinding[],
  context: ActionContext,
): (event: KeyboardEvent) => void {
  const platform = detectPlatform();

  return (event: KeyboardEvent) => {
    // Find matching in-app binding
    const binding = bindings.find(
      (b) => b.mode === 'inapp' && b.enabled && matchesBinding(event, b, platform),
    );
    if (!binding) return;

    // Special check for toggle_timer: ignore when typing in editable fields
    if (binding.action === 'toggle_timer' && isEditableShortcutTarget(event.target)) {
      return;
    }

    event.preventDefault();
    void executeAction(binding.action, context);
  };
}

// ── Global shortcut registration (JS plugin API) ───────────────────────

export function buildAccelerator(binding: ShortcutBinding): string {
  const parts: string[] = [];

  for (const mod of binding.modifiers) {
    // Map to the accelerator names expected by the plugin
    switch (mod) {
      case 'ctrl':
      case 'meta':
        parts.push('CommandOrControl');
        break;
      default:
        parts.push(mod.charAt(0).toUpperCase() + mod.slice(1));
    }
  }

  let key = binding.key;
  if (key === 'Space' || key === ' ') {
    key = 'Space';
  } else if (key.length === 1) {
    key = key.toUpperCase();
  } else {
    key = key.charAt(0).toUpperCase() + key.slice(1);
  }

  parts.push(key);
  return parts.join('+');
}

export interface GlobalShortcutFailure {
  binding: ShortcutBinding;
  accelerator: string;
  error: string;
}

// Returns the bindings that failed to register (hotkey occupied by another
// app, or the accelerator could not be parsed) so callers can surface them.
export async function registerGlobalShortcuts(
  bindings: ShortcutBinding[],
): Promise<GlobalShortcutFailure[]> {
  const isTauri = '__TAURI_INTERNALS__' in window;
  if (!isTauri) return [];

  // Unregister all existing global shortcuts first
  await unregisterAllGlobalShortcuts();

  const globals = bindings.filter((b) => b.mode === 'global' && b.enabled);
  if (globals.length === 0) return [];

  let plugin: typeof import('@tauri-apps/plugin-global-shortcut');
  try {
    plugin = await import('@tauri-apps/plugin-global-shortcut');
  } catch (err) {
    console.error('[shortcutManager] Failed to import global-shortcut plugin:', err);
    return globals.map((binding) => ({
      binding,
      accelerator: buildAccelerator(binding),
      error: String(err),
    }));
  }

  const failures: GlobalShortcutFailure[] = [];

  for (const binding of globals) {
    const accelerator = buildAccelerator(binding);
    const action = binding.action;

    try {
      await plugin.register(accelerator, (event) => {
        if (event.state !== 'Pressed') return;
        window.dispatchEvent(
          new CustomEvent('shortcut:global-triggered', {
            detail: { action },
          }),
        );
      });
    } catch (err) {
      console.error(
        `[shortcutManager] Failed to register global shortcut "${binding.label}" (${accelerator}):`,
        err,
      );
      failures.push({ binding, accelerator, error: String(err) });
    }
  }

  return failures;
}

export async function unregisterAllGlobalShortcuts(): Promise<void> {
  const isTauri = '__TAURI_INTERNALS__' in window;
  if (!isTauri) return;

  try {
    const { unregisterAll } = await import('@tauri-apps/plugin-global-shortcut');
    await unregisterAll();
  } catch (err) {
    console.error('[shortcutManager] Failed to unregisterAll:', err);
  }
}
