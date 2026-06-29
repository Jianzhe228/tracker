<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';
import { sendNotification, ensureNotificationPermission } from '../services/notification';
import { dataExportJson, dataExportToFile, dataImportFromFile, dataClearAll } from '../services/commands/data';
import { testWebDavConnection, webdavUpload, webdavDownload, webdavSyncStatus } from '../services/commands/sync';
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog';
import { enable as enableAutoStart, disable as disableAutoStart, isEnabled as isAutoStartEnabled } from '@tauri-apps/plugin-autostart';
import { patternList, patternCreate, patternUpdate, patternDelete } from '../services/commands/pattern';
import { getAppVersion } from '../services/commands/health';
import { callChatCompletion } from '../services/ai/client';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import type { SubtaskPattern } from '../types/domain';
import type { ShortcutBinding, ShortcutModifier, ShortcutMode } from '../types/domain';
import { DEFAULT_SHORTCUTS } from '../services/shortcutManager';

const packageVersion = import.meta.env.PACKAGE_VERSION || '0.0.0';

const settingsStore = useSettingsStore();
const uiStore = useUiStore();
const isTauri = '__TAURI_INTERNALS__' in window;

const NAV_ITEMS = [
  { id: 'general', label: '通用' },
  { id: 'pomodoro', label: '番茄钟' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'sync', label: '云同步' },
  { id: 'notification', label: '通知' },
  { id: 'patterns', label: '子任务模板' },
  { id: 'ai', label: 'AI' },
  { id: 'about', label: '关于与更新' },
  { id: 'data', label: '数据管理' },
];

const contentRef = ref<HTMLElement | null>(null);
const activeSection = ref('general');
let scrollHandler: (() => void) | null = null;

function updateActiveSection(): void {
  const container = contentRef.value;
  if (!container) return;
  const containerTop = container.getBoundingClientRect().top;
  for (let i = NAV_ITEMS.length - 1; i >= 0; i--) {
    const el = document.getElementById(NAV_ITEMS[i].id);
    if (el && el.getBoundingClientRect().top - containerTop <= 80) {
      activeSection.value = NAV_ITEMS[i].id;
      return;
    }
  }
  activeSection.value = NAV_ITEMS[0].id;
}

function scrollToSection(id: string): void {
  activeSection.value = id;
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const focus = computed({
  get: () => settingsStore.timer.focusMinutes,
  set: (value: number) => settingsStore.updateTimer({ focusMinutes: value })
});

const shortBreak = computed({
  get: () => settingsStore.timer.shortBreakMinutes,
  set: (value: number) => settingsStore.updateTimer({ shortBreakMinutes: value })
});

const longBreak = computed({
  get: () => settingsStore.timer.longBreakMinutes,
  set: (value: number) => settingsStore.updateTimer({ longBreakMinutes: value })
});

const longBreakInterval = computed({
  get: () => settingsStore.timer.longBreakInterval,
  set: (value: number) => settingsStore.updateTimer({ longBreakInterval: value })
});

const autoStartBreak = computed({
  get: () => settingsStore.timer.autoStartBreak,
  set: (value: boolean) => settingsStore.updateTimer({ autoStartBreak: value })
});

const autoStartNext = computed({
  get: () => settingsStore.timer.autoStartNext,
  set: (value: boolean) => settingsStore.updateTimer({ autoStartNext: value })
});

const defaultTimerKind = computed({
  get: () => settingsStore.timer.defaultTimerKind,
  set: (value: 'countdown' | 'countup') => settingsStore.updateTimer({ defaultTimerKind: value })
});

const notifyStart = computed({
  get: () => settingsStore.notification.notifyFocusStart,
  set: (value: boolean) => settingsStore.updateNotification({ notifyFocusStart: value })
});

const notifyEnd = computed({
  get: () => settingsStore.notification.notifyFocusEnd,
  set: (value: boolean) => settingsStore.updateNotification({ notifyFocusEnd: value })
});

const notifyBreakEnd = computed({
  get: () => settingsStore.notification.notifyBreakEnd,
  set: (value: boolean) => settingsStore.updateNotification({ notifyBreakEnd: value })
});

const notifyDeadline = computed({
  get: () => settingsStore.notification.notifyDeadline,
  set: (value: boolean) => settingsStore.updateNotification({ notifyDeadline: value })
});

const soundEnabled = computed({
  get: () => settingsStore.notification.soundEnabled,
  set: (value: boolean) => settingsStore.updateNotification({ soundEnabled: value })
});

const closeToTray = computed({
  get: () => settingsStore.closeToTray,
  set: (value: boolean) => settingsStore.updateCloseToTray(value)
});

const autoStart = ref(false);

async function toggleAutoStart(): Promise<void> {
  if (!isTauri) return;
  try {
    if (autoStart.value) {
      await disableAutoStart();
    } else {
      await enableAutoStart();
    }
    autoStart.value = await isAutoStartEnabled();
  } catch (e) {
    console.error('[settings] autostart toggle failed', e);
  }
}

const syncStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle');
const syncLoading = ref(false);
const syncMessage = ref('');
const lastSyncAt = ref<string | null>(null);
const showClearConfirm = ref(false);
const showDownloadConfirm = ref(false);
const exportStatus = ref<'idle' | 'exporting' | 'done'>('idle');
const exportPath = ref('');
const clearStatus = ref<'idle' | 'clearing'>('idle');

const updateStatus = ref<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'none'>('idle');
const updateError = ref('');
const updateInfo = ref<{ version: string; notes: string } | null>(null);
const currentVersion = ref('');
const downloadProgress = ref(0); // -1 = indeterminate (contentLength unknown)
const pendingUpdate = shallowRef<Update | null>(null);

// ── Pattern template management ────────────────────────────────────
const patterns = ref<SubtaskPattern[]>([]);
const showPatternForm = ref(false);
const editingPatternId = ref<number | null>(null);
const patternFormName = ref('');
const patternFormKeywords = ref('');
const patternFormSubtasks = ref('');

async function loadPatterns(): Promise<void> {
  if (!isTauri) return;
  try {
    patterns.value = await patternList();
  } catch (e) {
    console.error('[settings] failed to load patterns', e);
  }
}

function openNewPatternForm(): void {
  editingPatternId.value = null;
  patternFormName.value = '';
  patternFormKeywords.value = '';
  patternFormSubtasks.value = '';
  showPatternForm.value = true;
}

function openEditPatternForm(p: SubtaskPattern): void {
  editingPatternId.value = p.id;
  patternFormName.value = p.name;
  patternFormKeywords.value = p.keywords.join('、');
  patternFormSubtasks.value = p.subtasks.join('、');
  showPatternForm.value = true;
}

function cancelPatternForm(): void {
  showPatternForm.value = false;
  editingPatternId.value = null;
}

function parseList(input: string): string[] {
  return input
    .split(/[,，、\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function savePattern(): Promise<void> {
  const name = patternFormName.value.trim();
  const keywords = parseList(patternFormKeywords.value);
  const subtasks = parseList(patternFormSubtasks.value);

  if (!name || keywords.length === 0 || subtasks.length === 0) {
    uiStore.notify('请填写模板名称、关键词和子任务');
    return;
  }

  try {
    if (editingPatternId.value) {
      await patternUpdate(editingPatternId.value, { name, keywords, subtasks });
    } else {
      await patternCreate({ name, keywords, subtasks });
    }
    await loadPatterns();
    cancelPatternForm();
    uiStore.notify(editingPatternId.value ? '模板已更新' : '模板已创建');
  } catch (e) {
    uiStore.notify('保存失败：' + String(e));
  }
}

async function removePattern(id: number): Promise<void> {
  try {
    await patternDelete(id);
    await loadPatterns();
    uiStore.notify('模板已删除');
  } catch (e) {
    uiStore.notify('删除失败：' + String(e));
  }
}

// ── Shortcut settings ────────────────────────────────────────────────

const shortcuts = computed({
  get: () => settingsStore.shortcuts,
  set: (value: ShortcutBinding[]) => settingsStore.updateShortcuts(value),
});

const recordingId = ref<string | null>(null);
let recordingCleanup: (() => void) | null = null;

function modLabel(mod: ShortcutModifier): string {
  const platform = navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other';
  const map: Record<ShortcutModifier, string> = {
    ctrl: platform === 'mac' ? 'Cmd' : 'Ctrl',
    alt: platform === 'mac' ? 'Opt' : 'Alt',
    shift: 'Shift',
    meta: 'Win',
  };
  return map[mod];
}

function keyLabel(key: string): string {
  const special: Record<string, string> = {
    ' ': 'Space',
    arrowup: 'Up',
    arrowdown: 'Down',
    arrowleft: 'Left',
    arrowright: 'Right',
    escape: 'Esc',
  };
  if (special[key.toLowerCase()]) return special[key.toLowerCase()];
  if (key.length === 1) return key.toUpperCase();
  // Capitalize first letter
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function startRecording(id: string): void {
  if (recordingCleanup) {
    recordingCleanup();
    recordingCleanup = null;
  }

  recordingId.value = id;

  const handler = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // Ignore pure modifier key presses
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
      return;
    }

    // Build modifier list from event
    const modifiers: ShortcutModifier[] = [];
    if (event.ctrlKey || event.metaKey) modifiers.push('ctrl');
    if (event.altKey) modifiers.push('alt');
    if (event.shiftKey) modifiers.push('shift');
    // meta without ctrl (raw Windows key)
    if (event.metaKey && !event.ctrlKey) {
      // Already handled by ctrl above on macOS (Cmd = meta)
      const isMac = navigator.platform.toLowerCase().includes('mac');
      if (!isMac) modifiers.push('meta');
    }

    // Map the key
    let key = event.key;
    if (event.code === 'Space') {
      key = 'Space';
    } else if (key.length === 1) {
      key = key.toLowerCase();
    }

    // Update the binding
    const newShortcuts = [...shortcuts.value];
    const bindingIndex = newShortcuts.findIndex((s) => s.id === id);
    if (bindingIndex >= 0) {
      newShortcuts[bindingIndex] = {
        ...newShortcuts[bindingIndex],
        key,
        modifiers,
      };
    }

    void settingsStore.updateShortcuts(newShortcuts);
    cleanup();
  };

  window.addEventListener('keydown', handler, { capture: true });

  const cleanup = () => {
    window.removeEventListener('keydown', handler, { capture: true });
    recordingId.value = null;
    recordingCleanup = null;
  };

  recordingCleanup = cleanup;

  // Auto-cancel after 10 seconds
  setTimeout(cleanup, 10000);
}

function setShortcutMode(index: number, mode: ShortcutMode): void {
  const binding = shortcuts.value[index];
  if (binding.action === 'toggle_timer' && mode === 'global') {
    uiStore.notify('Space 全局快捷键可能会影响在其他程序中的输入，建议仅在应用内使用', 4000);
  }
  const newShortcuts = [...shortcuts.value];
  newShortcuts[index] = { ...newShortcuts[index], mode };
  void settingsStore.updateShortcuts(newShortcuts);
}

function toggleShortcutEnabled(index: number): void {
  const newShortcuts = [...shortcuts.value];
  newShortcuts[index] = {
    ...newShortcuts[index],
    enabled: !newShortcuts[index].enabled,
  };
  void settingsStore.updateShortcuts(newShortcuts);
}

function resetShortcuts(): void {
  void settingsStore.updateShortcuts(DEFAULT_SHORTCUTS);
  uiStore.notify('快捷键已恢复默认');
}

onUnmounted(() => {
  if (recordingCleanup) recordingCleanup();
  if (scrollHandler) contentRef.value?.removeEventListener('scroll', scrollHandler);
  if (aiSaveTimer !== null) clearTimeout(aiSaveTimer);
});

function getWebDavParams() {
  return {
    url: settingsStore.webdav.url,
    username: settingsStore.webdav.username,
    password: settingsStore.webdav.password,
    path: settingsStore.webdav.path,
  };
}

function validateWebDavConfig(): boolean {
  const { url, username, password } = getWebDavParams();
  if (!url || !username || !password) {
    uiStore.notify('请先填写 WebDAV 服务器地址、用户名和密码');
    return false;
  }
  return true;
}

async function testConnection(): Promise<void> {
  if (!isTauri) {
    uiStore.notify('同步功能仅在桌面端可用');
    return;
  }
  if (!validateWebDavConfig()) return;

  syncStatus.value = 'testing';
  syncMessage.value = '';
  try {
    const { url, username, password, path } = getWebDavParams();
    const msg = await testWebDavConnection(url, username, password, path);
    syncStatus.value = 'success';
    syncMessage.value = msg;
    uiStore.notify(msg);
  } catch (err) {
    syncStatus.value = 'error';
    syncMessage.value = String(err);
    uiStore.notify('连接失败：' + String(err));
  }
}

async function handleUpload(): Promise<void> {
  if (!isTauri) {
    uiStore.notify('同步功能仅在桌面端可用');
    return;
  }
  if (!validateWebDavConfig()) return;

  syncLoading.value = true;
  try {
    const { url, username, password, path } = getWebDavParams();
    const msg = await webdavUpload(url, username, password, path);
    uiStore.notify(msg);
    await loadSyncStatus();
  } catch (err) {
    uiStore.notify('上传失败：' + String(err));
  } finally {
    syncLoading.value = false;
  }
}

async function handleDownload(): Promise<void> {
  if (!isTauri) {
    uiStore.notify('同步功能仅在桌面端可用');
    return;
  }
  if (!validateWebDavConfig()) return;

  showDownloadConfirm.value = false;
  syncLoading.value = true;
  try {
    const { url, username, password, path } = getWebDavParams();
    const msg = await webdavDownload(url, username, password, path);
    uiStore.notify(msg + '，页面即将刷新…');
    setTimeout(() => window.location.reload(), 1000);
  } catch (err) {
    syncLoading.value = false;
    uiStore.notify('下载失败：' + String(err));
  }
}


async function loadSyncStatus(): Promise<void> {
  if (!isTauri) return;
  try {
    const result = await webdavSyncStatus();
    lastSyncAt.value = result.lastSyncAt;
  } catch {
    // Ignore errors on status check
  }
}

function formatSyncTime(isoStr: string | null): string {
  if (!isoStr) return '从未同步';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('zh-CN');
  } catch {
    return isoStr;
  }
}

async function saveWebDavSettings(): Promise<void> {
  await settingsStore.updateWebDav({
    url: settingsStore.webdav.url,
    username: settingsStore.webdav.username,
    password: settingsStore.webdav.password,
    path: settingsStore.webdav.path,
  });
  uiStore.notify('WebDAV 设置已保存');
}

async function saveAiSettings(): Promise<void> {
  await settingsStore.updateAi({
    endpoint: settingsStore.ai.endpoint,
    apiKey: settingsStore.ai.apiKey,
    model: settingsStore.ai.model,
  });
}

const aiTesting = ref(false);
let aiSaveTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => [settingsStore.ai.endpoint, settingsStore.ai.apiKey, settingsStore.ai.model],
  () => {
    if (aiSaveTimer !== null) clearTimeout(aiSaveTimer);
    aiSaveTimer = window.setTimeout(() => {
      void saveAiSettings();
      aiSaveTimer = null;
    }, 800);
  }
);

async function testAiConnection(): Promise<void> {
  const { endpoint, apiKey, model } = settingsStore.ai;
  if (!endpoint || !apiKey || !model) {
    uiStore.notify('请先填写 Endpoint、API Key 和 Model');
    return;
  }
  aiTesting.value = true;
  try {
    await callChatCompletion(endpoint, apiKey, model, [
      { role: 'user', content: '连接测试，请只返回 JSON：{"ok": true}' },
    ], 10_000);
    uiStore.notify('AI 连接成功');
  } catch (err) {
    const message = err instanceof DOMException && err.name === 'AbortError'
      ? '请求超时（10 秒）'
      : String(err);
    uiStore.notify('AI 连接失败：' + message);
  } finally {
    aiTesting.value = false;
  }
}

async function testNotification(): Promise<void> {
  await ensureNotificationPermission();
  sendNotification({
    type: 'focusStart',
    title: 'Tracker',
    body: '这是一条测试通知',
  });
}

async function handleExportJson(): Promise<void> {
  if (!isTauri) {
    uiStore.notify('导出功能仅在桌面端可用');
    return;
  }
  exportStatus.value = 'exporting';
  try {
    const result = await dataExportJson();
    exportPath.value = result.path;
    exportStatus.value = 'done';
    uiStore.notify(`数据已导出到 ${result.path}`);
  } catch (err) {
    exportStatus.value = 'idle';
    uiStore.notify('导出失败：' + String(err));
  }
}

async function handleExportToFile(): Promise<void> {
  if (!isTauri) {
    uiStore.notify('导出功能仅在桌面端可用');
    return;
  }
  try {
    const filePath = await saveDialog({
      title: '导出数据',
      defaultPath: `tracker_export_${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!filePath) return;
    exportStatus.value = 'exporting';
    const result = await dataExportToFile(filePath);
    exportPath.value = result.path;
    exportStatus.value = 'done';
    uiStore.notify('数据已导出到所选文件');
  } catch (err) {
    exportStatus.value = 'idle';
    uiStore.notify('导出失败：' + String(err));
  }
}

const importStatus = ref<'idle' | 'importing'>('idle');

async function handleImportFromFile(): Promise<void> {
  if (!isTauri) {
    uiStore.notify('导入功能仅在桌面端可用');
    return;
  }
  try {
    const filePath = await openDialog({
      title: '选择导入文件',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false,
      directory: false,
    });
    if (!filePath) return;
    const confirmed = await uiStore.confirm(
      '导入将覆盖当前所有数据，建议先导出备份。确定继续？',
      { title: '导入数据', confirmText: '确认导入' },
    );
    if (!confirmed) return;
    importStatus.value = 'importing';
    await dataImportFromFile(filePath);
    uiStore.notify('导入成功，页面即将刷新…');
    setTimeout(() => window.location.reload(), 1000);
  } catch (err) {
    importStatus.value = 'idle';
    uiStore.notify('导入失败：' + String(err));
  }
}

async function handleClearAll(): Promise<void> {
  if (!isTauri) {
    uiStore.notify('清空功能仅在桌面端可用');
    return;
  }
  clearStatus.value = 'clearing';
  try {
    await dataClearAll();
    showClearConfirm.value = false;
    clearStatus.value = 'idle';
    uiStore.notify('所有数据已清空');
    // Reload the page to reset all stores
    window.location.reload();
  } catch (err) {
    clearStatus.value = 'idle';
    uiStore.notify('清空失败：' + String(err));
  }
}

onMounted(() => {
  loadSyncStatus();
  loadPatterns();
  if (isTauri) {
    isAutoStartEnabled().then(v => { autoStart.value = v; }).catch(() => {});
    getAppVersion().then(v => { currentVersion.value = v; }).catch(() => {});
  }
  const container = contentRef.value;
  if (container) {
    scrollHandler = updateActiveSection;
    container.addEventListener('scroll', scrollHandler);
    updateActiveSection();
  }
});

async function checkForUpdates(): Promise<void> {
  if (!isTauri) {
    uiStore.notify('更新功能仅在桌面端可用');
    return;
  }
  updateStatus.value = 'checking';
  updateError.value = '';
  updateInfo.value = null;
  pendingUpdate.value = null;
  try {
    const update = await check();
    if (update) {
      pendingUpdate.value = update;
      updateInfo.value = {
        version: update.version,
        notes: update.body || '',
      };
      updateStatus.value = 'available';
    } else {
      updateStatus.value = 'none';
      uiStore.notify('已是最新版本');
    }
  } catch (e) {
    updateStatus.value = 'error';
    updateError.value = String(e);
    uiStore.notify('检查更新失败：' + String(e));
  }
}

async function downloadAndInstall(): Promise<void> {
  if (!isTauri) return;
  updateStatus.value = 'downloading';
  downloadProgress.value = 0;
  try {
    const update = pendingUpdate.value ?? await check();
    if (update) {
      let totalLength = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalLength = event.data.contentLength ?? 0;
          if (totalLength === 0) downloadProgress.value = -1; // indeterminate
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          downloadProgress.value = totalLength > 0 ? Math.round((downloaded / totalLength) * 100) : -1;
        } else if (event.event === 'Finished') {
          downloadProgress.value = 100;
        }
      });
      updateStatus.value = 'ready';
      await relaunch();
    } else {
      updateStatus.value = 'none';
      uiStore.notify('已是最新版本');
    }
  } catch (e) {
    updateStatus.value = 'error';
    updateError.value = String(e);
    uiStore.notify('下载更新失败：' + String(e));
  }
}
</script>

<template>
  <div class="flex h-full">
    <nav class="w-36 shrink-0 overflow-y-auto border-r border-surface-border bg-[#F5F5F3] py-6 pl-4 pr-2">
      <ul class="space-y-0.5">
        <li v-for="item in NAV_ITEMS" :key="item.id">
          <a
            href="#"
            class="block cursor-pointer rounded-md px-2.5 py-1.5 text-sm transition-colors"
            :class="activeSection === item.id ? 'bg-primary-50 text-primary-600 font-medium' : 'text-[#6F6F6B] hover:bg-surface-hover'"
            @click.prevent="scrollToSection(item.id)"
          >{{ item.label }}</a>
        </li>
      </ul>
    </nav>
    <div ref="contentRef" class="flex-1 overflow-y-auto space-y-5 bg-[#F5F5F3] px-6 pt-6 pb-20">
      <!-- 通用 -->
      <section id="general" class="rounded-xl border border-surface-border bg-white px-6 py-5 shadow-sm">
        <h2 class="mb-4 text-base font-semibold text-[#1C1C1A]">通用</h2>
        <div class="divide-y divide-surface-border">
          <div class="flex items-center justify-between gap-4 py-3">
            <div><span class="text-sm text-[#1C1C1A]">关闭时最小化到托盘</span><p class="text-xs text-[#9E9E9A]">开启后，点击关闭按钮将最小化到系统托盘而非退出程序</p></div>
            <button role="switch" :aria-checked="closeToTray" class="relative h-6 w-10 shrink-0 rounded-full transition-colors" :class="closeToTray ? 'bg-primary-600' : 'bg-surface-border'" @click="closeToTray = !closeToTray"><span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform" :class="closeToTray ? 'translate-x-4' : 'translate-x-0'" /></button>
          </div>
          <div class="flex items-center justify-between gap-4 py-3">
            <div><span class="text-sm text-[#1C1C1A]">开机自动启动</span><p class="text-xs text-[#9E9E9A]">系统启动时自动运行本程序</p></div>
            <button role="switch" :aria-checked="autoStart" class="relative h-6 w-10 shrink-0 rounded-full transition-colors" :class="autoStart ? 'bg-primary-600' : 'bg-surface-border'" @click="toggleAutoStart"><span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform" :class="autoStart ? 'translate-x-4' : 'translate-x-0'" /></button>
          </div>
        </div>
      </section>

      <!-- 番茄钟 -->
      <section id="pomodoro" class="rounded-xl border border-surface-border bg-white px-6 py-5 shadow-sm">
        <h2 class="mb-4 text-base font-semibold text-[#1C1C1A]">番茄钟</h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label class="space-y-1.5">
            <span class="text-sm text-[#6F6F6B]">专注（分钟）</span>
            <input v-model.number="focus" type="number" min="1" max="120" class="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </label>
          <label class="space-y-1.5">
            <span class="text-sm text-[#6F6F6B]">短休息（分钟）</span>
            <input v-model.number="shortBreak" type="number" min="1" max="30" class="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </label>
          <label class="space-y-1.5">
            <span class="text-sm text-[#6F6F6B]">长休息（分钟）</span>
            <input v-model.number="longBreak" type="number" min="1" max="60" class="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </label>
          <label class="space-y-1.5">
            <span class="text-sm text-[#6F6F6B]">长休息间隔</span>
            <input v-model.number="longBreakInterval" type="number" min="1" max="10" class="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </label>
        </div>
        <div class="mt-5 divide-y divide-surface-border">
          <div class="flex items-center justify-between gap-4 py-3">
            <div><span class="text-sm text-[#1C1C1A]">自动开始休息</span><p class="text-xs text-[#9E9E9A]">专注结束后自动进入休息</p></div>
            <button role="switch" :aria-checked="autoStartBreak" class="relative h-6 w-10 shrink-0 rounded-full transition-colors" :class="autoStartBreak ? 'bg-primary-600' : 'bg-surface-border'" @click="autoStartBreak = !autoStartBreak"><span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform" :class="autoStartBreak ? 'translate-x-4' : 'translate-x-0'" /></button>
          </div>
          <div class="flex items-center justify-between gap-4 py-3">
            <div><span class="text-sm text-[#1C1C1A]">自动开始下一个番茄</span><p class="text-xs text-[#9E9E9A]">休息结束后自动开始专注</p></div>
            <button role="switch" :aria-checked="autoStartNext" class="relative h-6 w-10 shrink-0 rounded-full transition-colors" :class="autoStartNext ? 'bg-primary-600' : 'bg-surface-border'" @click="autoStartNext = !autoStartNext"><span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform" :class="autoStartNext ? 'translate-x-4' : 'translate-x-0'" /></button>
          </div>
          <div class="flex items-center justify-between gap-4 py-3">
            <div><span class="text-sm text-[#1C1C1A]">默认计时模式</span><p class="text-xs text-[#9E9E9A]">新建专注时的默认计时方式</p></div>
            <div class="flex gap-1 rounded-full bg-surface-hover p-1">
              <button class="rounded-full px-3 py-1 text-xs font-medium transition-colors" :class="defaultTimerKind === 'countdown' ? 'bg-white text-[#1C1C1A] shadow-sm' : 'text-[#6F6F6B]'" @click="defaultTimerKind = 'countdown'">倒计时</button>
              <button class="rounded-full px-3 py-1 text-xs font-medium transition-colors" :class="defaultTimerKind === 'countup' ? 'bg-white text-[#1C1C1A] shadow-sm' : 'text-[#6F6F6B]'" @click="defaultTimerKind = 'countup'">正计时</button>
            </div>
          </div>
        </div>
      </section>

      <!-- 快捷键 -->
      <section id="shortcuts" class="rounded-xl border border-surface-border bg-white px-6 py-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-base font-semibold text-[#1C1C1A]">快捷键</h2>
          <button
            class="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-[#6F6F6B] hover:bg-surface-hover"
            @click="resetShortcuts"
          >恢复默认</button>
        </div>

        <div class="divide-y divide-surface-border">
          <div
            v-for="(binding, index) in shortcuts"
            :key="binding.id"
            class="flex items-center justify-between gap-4 py-3"
          >
            <!-- Label -->
            <div class="min-w-0 w-32">
              <span class="text-sm text-[#1C1C1A]">{{ binding.label }}</span>
            </div>

            <!-- Key combo display + Record button -->
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-1">
                <kbd
                  v-for="mod in binding.modifiers"
                  :key="mod"
                  class="rounded border border-surface-border bg-surface-hover px-1.5 py-0.5 text-[11px] font-mono text-[#6F6F6B]"
                >{{ modLabel(mod) }}</kbd>
                <kbd
                  class="rounded border border-surface-border bg-surface-hover px-1.5 py-0.5 text-[11px] font-mono text-[#6F6F6B]"
                >{{ keyLabel(binding.key) }}</kbd>
              </div>

              <button
                class="rounded-md border border-surface-border px-2.5 py-1 text-xs transition-colors"
                :class="recordingId === binding.id ? 'bg-primary-50 text-primary-600 border-primary-300' : 'text-[#6F6F6B] hover:bg-surface-hover'"
                @click="startRecording(binding.id)"
              >
                {{ recordingId === binding.id ? '按键中…' : '录制' }}
              </button>
            </div>

            <!-- Mode toggle: In-app / Global -->
            <div class="flex gap-1 rounded-full bg-surface-hover p-1 shrink-0">
              <button
                class="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                :class="binding.mode === 'inapp' ? 'bg-white text-[#1C1C1A] shadow-sm' : 'text-[#6F6F6B]'"
                @click="setShortcutMode(index, 'inapp')"
              >应用内</button>
              <button
                class="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                :class="binding.mode === 'global' ? 'bg-white text-[#1C1C1A] shadow-sm' : 'text-[#6F6F6B]'"
                @click="setShortcutMode(index, 'global')"
              >全局</button>
            </div>

            <!-- Enable/disable toggle -->
            <button
              role="switch"
              :aria-checked="binding.enabled"
              class="relative h-6 w-10 shrink-0 rounded-full transition-colors"
              :class="binding.enabled ? 'bg-primary-600' : 'bg-surface-border'"
              @click="toggleShortcutEnabled(index)"
            >
              <span
                class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                :class="binding.enabled ? 'translate-x-4' : 'translate-x-0'"
              />
            </button>
          </div>
        </div>
      </section>

      <!-- 云同步 -->
      <section id="sync" class="rounded-xl border border-surface-border bg-white px-6 py-5 shadow-sm">
        <h2 class="mb-4 text-base font-semibold text-[#1C1C1A]">云同步</h2>
        <div class="space-y-4">
          <label class="block">
            <span class="mb-1 block text-sm text-[#6F6F6B]">服务器地址</span>
            <input v-model="settingsStore.webdav.url" type="url" placeholder="https://dav.example.com/webdav/" class="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </label>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1 block text-sm text-[#6F6F6B]">用户名</span>
              <input v-model="settingsStore.webdav.username" type="text" class="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
            </label>
            <label class="block">
              <span class="mb-1 block text-sm text-[#6F6F6B]">密码</span>
              <input v-model="settingsStore.webdav.password" type="password" class="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
            </label>
          </div>
          <label class="block">
            <span class="mb-1 block text-sm text-[#6F6F6B]">同步路径</span>
            <input v-model="settingsStore.webdav.path" type="text" class="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </label>
          <div class="flex flex-wrap items-center gap-3 pt-2">
            <button class="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50" :disabled="syncLoading" @click="saveWebDavSettings">保存</button>
            <button class="rounded-lg border border-surface-border px-4 py-2 text-sm text-[#6F6F6B] hover:bg-surface-hover disabled:opacity-50" :disabled="syncStatus === 'testing' || syncLoading" @click="testConnection">{{ syncStatus === 'testing' ? '测试中…' : '测试连接' }}</button>
            <button class="rounded-lg border border-surface-border px-4 py-2 text-sm text-[#6F6F6B] hover:bg-surface-hover disabled:opacity-50" :disabled="syncLoading" @click="handleUpload">上传到云端</button>
            <template v-if="!showDownloadConfirm">
              <button class="rounded-lg border border-surface-border px-4 py-2 text-sm text-[#6F6F6B] hover:bg-surface-hover disabled:opacity-50" :disabled="syncLoading" @click="showDownloadConfirm = true">从云端下载</button>
            </template>
            <template v-else>
              <button class="rounded-lg bg-danger-600 px-4 py-2 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50" :disabled="syncLoading" @click="handleDownload">确认下载（覆盖本地）</button>
              <button class="rounded-lg border border-surface-border px-4 py-2 text-sm text-[#6F6F6B] hover:bg-surface-hover" @click="showDownloadConfirm = false">取消</button>
            </template>
          </div>
          <p v-if="syncMessage" class="text-xs" :class="syncStatus === 'success' ? 'text-success-500' : syncStatus === 'error' ? 'text-danger-400' : 'text-[#6F6F6B]'">{{ syncMessage }}</p>
          <p class="text-xs text-[#9E9E9A]">最后同步：{{ formatSyncTime(lastSyncAt) }}</p>
        </div>
      </section>

      <!-- 通知 -->
      <section id="notification" class="rounded-xl border border-surface-border bg-white px-6 py-5 shadow-sm">
        <h2 class="mb-4 text-base font-semibold text-[#1C1C1A]">通知</h2>
        <div class="divide-y divide-surface-border">
          <div class="flex items-center justify-between gap-4 py-3">
            <div><span class="text-sm text-[#1C1C1A]">番茄钟开始</span><p class="text-xs text-[#9E9E9A]">开始专注时通知</p></div>
            <button role="switch" :aria-checked="notifyStart" class="relative h-6 w-10 shrink-0 rounded-full transition-colors" :class="notifyStart ? 'bg-primary-600' : 'bg-surface-border'" @click="notifyStart = !notifyStart"><span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform" :class="notifyStart ? 'translate-x-4' : 'translate-x-0'" /></button>
          </div>
          <div class="flex items-center justify-between gap-4 py-3">
            <div><span class="text-sm text-[#1C1C1A]">番茄钟结束</span><p class="text-xs text-[#9E9E9A]">专注结束时通知</p></div>
            <button role="switch" :aria-checked="notifyEnd" class="relative h-6 w-10 shrink-0 rounded-full transition-colors" :class="notifyEnd ? 'bg-primary-600' : 'bg-surface-border'" @click="notifyEnd = !notifyEnd"><span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform" :class="notifyEnd ? 'translate-x-4' : 'translate-x-0'" /></button>
          </div>
          <div class="flex items-center justify-between gap-4 py-3">
            <div><span class="text-sm text-[#1C1C1A]">休息结束</span><p class="text-xs text-[#9E9E9A]">休息结束时通知</p></div>
            <button role="switch" :aria-checked="notifyBreakEnd" class="relative h-6 w-10 shrink-0 rounded-full transition-colors" :class="notifyBreakEnd ? 'bg-primary-600' : 'bg-surface-border'" @click="notifyBreakEnd = !notifyBreakEnd"><span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform" :class="notifyBreakEnd ? 'translate-x-4' : 'translate-x-0'" /></button>
          </div>
          <div class="flex items-center justify-between gap-4 py-3">
            <div><span class="text-sm text-[#1C1C1A]">任务截止提醒</span><p class="text-xs text-[#9E9E9A]">临近截止时通知</p></div>
            <button role="switch" :aria-checked="notifyDeadline" class="relative h-6 w-10 shrink-0 rounded-full transition-colors" :class="notifyDeadline ? 'bg-primary-600' : 'bg-surface-border'" @click="notifyDeadline = !notifyDeadline"><span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform" :class="notifyDeadline ? 'translate-x-4' : 'translate-x-0'" /></button>
          </div>
          <div class="flex items-center justify-between gap-4 py-3">
            <div><span class="text-sm text-[#1C1C1A]">提示音</span><p class="text-xs text-[#9E9E9A]">计时开始/结束与完成任务时播放短音</p></div>
            <button role="switch" :aria-checked="soundEnabled" class="relative h-6 w-10 shrink-0 rounded-full transition-colors" :class="soundEnabled ? 'bg-primary-600' : 'bg-surface-border'" @click="soundEnabled = !soundEnabled"><span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform" :class="soundEnabled ? 'translate-x-4' : 'translate-x-0'" /></button>
          </div>
        </div>
        <div class="mt-3">
          <button class="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-[#6F6F6B] hover:bg-surface-hover" @click="testNotification">发送测试通知</button>
        </div>
      </section>

      <!-- 子任务模板 -->
      <section id="patterns" class="rounded-xl border border-surface-border bg-white px-6 py-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-base font-semibold text-[#1C1C1A]">子任务模板</h2>
          <button class="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700" @click="openNewPatternForm">新增模板</button>
        </div>

        <div v-if="showPatternForm" class="mb-4 rounded-lg border border-surface-border bg-surface-hover p-4 space-y-3">
          <label class="block space-y-1">
            <span class="text-xs font-medium text-[#6F6F6B]">模板名称</span>
            <input v-model.trim="patternFormName" type="text" placeholder="如：健身运动" class="h-9 w-full rounded-lg border border-surface-border px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500">
          </label>
          <label class="block space-y-1">
            <span class="text-xs font-medium text-[#6F6F6B]">匹配关键词</span>
            <input v-model.trim="patternFormKeywords" type="text" placeholder="健身、锻炼、运动（顿号或逗号分隔）" class="h-9 w-full rounded-lg border border-surface-border px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500">
          </label>
          <label class="block space-y-1">
            <span class="text-xs font-medium text-[#6F6F6B]">子任务清单</span>
            <input v-model.trim="patternFormSubtasks" type="text" placeholder="水杯、运动鞋、毛巾（顿号或逗号分隔）" class="h-9 w-full rounded-lg border border-surface-border px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500">
          </label>
          <div class="flex gap-2 pt-1">
            <button class="rounded-md bg-primary-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-primary-700" @click="savePattern">{{ editingPatternId ? '更新' : '创建' }}</button>
            <button class="rounded-md border border-surface-border px-3.5 py-1.5 text-xs text-[#6F6F6B] hover:bg-surface-hover" @click="cancelPatternForm">取消</button>
          </div>
        </div>

        <div v-if="patterns.length === 0 && !showPatternForm" class="text-sm text-[#9E9E9A]">暂无模板，点击右上方新增。</div>
        <div v-else class="divide-y divide-surface-border">
          <div v-for="p in patterns" :key="p.id" class="py-4">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-[#1C1C1A]">{{ p.name }}</span>
                  <span v-if="p.isBuiltin" class="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-[#6F6F6B]">内置</span>
                  <span v-if="p.usageCount > 0" class="text-[10px] text-[#9E9E9A]">已用 {{ p.usageCount }} 次</span>
                </div>
                <div class="mt-1.5 flex flex-wrap gap-1">
                  <span v-for="kw in p.keywords" :key="kw" class="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] text-primary-500">{{ kw }}</span>
                </div>
                <div class="mt-1.5 flex flex-wrap gap-1.5">
                  <span v-for="st in p.subtasks" :key="st" class="rounded-md border border-surface-border px-2 py-0.5 text-xs text-[#6F6F6B]">{{ st }}</span>
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <button class="rounded-md border border-surface-border px-2.5 py-1 text-xs text-[#6F6F6B] hover:bg-surface-hover" @click="openEditPatternForm(p)">编辑</button>
                <button class="rounded-md border border-danger-200 px-2.5 py-1 text-xs text-danger-400 hover:bg-danger-50" @click="removePattern(p.id)">删除</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- AI -->
      <section id="ai" class="rounded-xl border border-surface-border bg-white px-6 py-5 shadow-sm">
        <h2 class="mb-4 text-base font-semibold text-[#1C1C1A]">AI</h2>
        <div class="space-y-4">
          <label class="block space-y-1.5">
            <span class="text-sm text-[#6F6F6B]">API Endpoint</span>
            <input v-model.trim="settingsStore.ai.endpoint" type="text" placeholder="https://api.openai.com/v1/chat/completions" class="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500">
          </label>
          <label class="block space-y-1.5">
            <span class="text-sm text-[#6F6F6B]">API Key</span>
            <input v-model.trim="settingsStore.ai.apiKey" type="password" placeholder="输入你的 API Key" class="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500">
          </label>
          <label class="block space-y-1.5">
            <span class="text-sm text-[#6F6F6B]">Model</span>
            <input v-model.trim="settingsStore.ai.model" type="text" placeholder="gpt-4o-mini" class="w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500">
          </label>
          <div class="flex items-center gap-2 pt-2">
            <button class="rounded-lg border border-surface-border px-4 py-2 text-sm text-[#6F6F6B] hover:bg-surface-hover disabled:opacity-50" :disabled="aiTesting" @click="testAiConnection">{{ aiTesting ? '测试中…' : '测试连接' }}</button>
          </div>
          <p class="text-xs text-[#9E9E9A]">用于任务智能拆解建议。兼容 OpenAI 接口格式（OpenAI / DeepSeek / Ollama 等均可）。</p>
        </div>
      </section>

      <!-- 关于与更新 -->
      <section id="about" class="rounded-xl border border-surface-border bg-white px-6 py-5 shadow-sm">
        <h2 class="mb-4 text-base font-semibold text-[#1C1C1A]">关于与更新</h2>
        <div class="space-y-3">
          <div class="flex items-center justify-between gap-4">
            <div>
              <span class="text-sm text-[#1C1C1A]">当前版本</span>
              <p class="text-xs text-[#9E9E9A]">Smart Focus Tracker v{{ currentVersion || packageVersion }}</p>
            </div>
            <button class="rounded-lg border border-surface-border px-4 py-2 text-sm text-[#6F6F6B] hover:bg-surface-hover disabled:opacity-50" :disabled="updateStatus === 'checking'" @click="checkForUpdates">
              {{ updateStatus === 'checking' ? '检查中…' : '检查更新' }}
            </button>
          </div>
          <div v-if="updateStatus === 'available' || updateStatus === 'downloading'" class="rounded-lg border border-primary-200 bg-primary-50 p-4">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-primary-700">发现新版本 v{{ updateInfo?.version }}</p>
                <p v-if="updateInfo?.notes && updateStatus === 'available'" class="mt-1 text-xs text-primary-500 whitespace-pre-wrap">{{ updateInfo.notes }}</p>
                <template v-if="updateStatus === 'downloading'">
                  <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-primary-200">
                    <div
                      class="h-full rounded-full bg-primary-600 transition-all duration-200"
                      :class="downloadProgress < 0 ? 'w-full animate-pulse' : ''"
                      :style="downloadProgress >= 0 ? { width: downloadProgress + '%' } : {}"
                    />
                  </div>
                  <p class="mt-1 text-xs text-primary-500">
                    {{ downloadProgress < 0 ? '正在下载…' : `正在下载… ${downloadProgress}%` }}
                  </p>
                </template>
              </div>
              <button v-if="updateStatus === 'available'" class="shrink-0 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700" @click="downloadAndInstall">
                下载并安装
              </button>
            </div>
          </div>
          <div v-else-if="updateStatus === 'none'" class="rounded-lg border border-surface-border bg-surface-hover p-4">
            <p class="text-sm text-[#6F6F6B]">已是最新版本</p>
          </div>
          <div v-else-if="updateStatus === 'error'" class="rounded-lg border border-danger-200 bg-danger-50 p-4">
            <p class="text-sm text-danger-500">{{ updateError || '检查更新失败' }}</p>
          </div>
        </div>
      </section>

      <!-- 数据管理 -->
      <section id="data" class="rounded-xl border border-surface-border bg-white px-6 py-5 shadow-sm">
        <h2 class="mb-4 text-base font-semibold text-[#1C1C1A]">数据管理</h2>
        <div class="flex flex-wrap items-center gap-3">
          <button class="rounded-lg border border-surface-border px-4 py-2 text-sm text-[#6F6F6B] hover:bg-surface-hover disabled:opacity-50" :disabled="exportStatus === 'exporting'" @click="handleExportToFile">{{ exportStatus === 'exporting' ? '导出中…' : '导出到文件' }}</button>
          <button class="rounded-lg border border-surface-border px-4 py-2 text-sm text-[#6F6F6B] hover:bg-surface-hover disabled:opacity-50" :disabled="exportStatus === 'exporting'" @click="handleExportJson">导出到应用目录</button>
          <button class="rounded-lg border border-surface-border px-4 py-2 text-sm text-[#6F6F6B] hover:bg-surface-hover disabled:opacity-50" :disabled="importStatus === 'importing'" @click="handleImportFromFile">{{ importStatus === 'importing' ? '导入中…' : '从文件导入' }}</button>
        </div>
        <p v-if="exportStatus === 'done'" class="mt-2 text-xs text-success-500">已导出至：{{ exportPath }}</p>

        <div class="mt-6">
          <template v-if="!showClearConfirm">
            <button class="rounded-lg border border-danger-200 px-4 py-2 text-sm text-danger-500 hover:bg-danger-50" @click="showClearConfirm = true">清空所有数据</button>
          </template>
          <template v-else>
            <p class="mb-3 text-sm text-danger-500">确定清空所有数据？此操作不可撤销。</p>
            <div class="flex gap-3">
              <button class="rounded-lg border border-surface-border px-4 py-2 text-sm text-[#6F6F6B] hover:bg-surface-hover" @click="showClearConfirm = false">取消</button>
              <button class="rounded-lg bg-danger-600 px-4 py-2 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50" :disabled="clearStatus === 'clearing'" @click="handleClearAll">{{ clearStatus === 'clearing' ? '清空中…' : '确认清空' }}</button>
            </div>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>
