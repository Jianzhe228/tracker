<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';
import { useAiStore } from '../stores/aiStore';
import { sendNotification, ensureNotificationPermission } from '../services/notification';
import { dataExportJson, dataExportToFile, dataImportFromFile, dataClearAll } from '../services/commands/data';
import { testWebDavConnection, webdavUpload, webdavDownload, webdavSyncStatus } from '../services/commands/sync';
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog';
import { patternList, patternCreate, patternUpdate, patternDelete } from '../services/commands/pattern';
import type { SubtaskPattern } from '../types/domain';

const settingsStore = useSettingsStore();
const uiStore = useUiStore();
const aiStore = useAiStore();
const activeTab = ref<'timer' | 'sync' | 'notifications' | 'ai' | 'patterns' | 'data'>('timer');

const isTauri = '__TAURI_INTERNALS__' in window;

const focus = computed({
  get: () => settingsStore.timer.focusMinutes,
  set: (value: number) => settingsStore.updatePomodoro({ focusMinutes: value })
});

const shortBreak = computed({
  get: () => settingsStore.timer.shortBreakMinutes,
  set: (value: number) => settingsStore.updatePomodoro({ shortBreakMinutes: value })
});

const longBreak = computed({
  get: () => settingsStore.timer.longBreakMinutes,
  set: (value: number) => settingsStore.updatePomodoro({ longBreakMinutes: value })
});

const longBreakInterval = computed({
  get: () => settingsStore.timer.longBreakInterval,
  set: (value: number) => settingsStore.updatePomodoro({ longBreakInterval: value })
});

const autoStartBreak = computed({
  get: () => settingsStore.timer.autoStartBreak,
  set: (value: boolean) => settingsStore.updatePomodoro({ autoStartBreak: value })
});

const autoStartNext = computed({
  get: () => settingsStore.timer.autoStartNext,
  set: (value: boolean) => settingsStore.updatePomodoro({ autoStartNext: value })
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

const syncStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle');
const syncLoading = ref(false);
const syncMessage = ref('');
const lastSyncAt = ref<string | null>(null);
const showClearConfirm = ref(false);
const showDownloadConfirm = ref(false);
const exportStatus = ref<'idle' | 'exporting' | 'done'>('idle');
const exportPath = ref('');
const clearStatus = ref<'idle' | 'clearing'>('idle');
const editingSkillId = ref<number | null>(null);
const editSkillSystemPrompt = ref('');
const editSkillUserPromptTemplate = ref('');

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

async function syncNow(): Promise<void> {
  if (!isTauri) {
    uiStore.notify('同步功能仅在桌面端可用');
    return;
  }
  if (!validateWebDavConfig()) return;

  syncLoading.value = true;
  try {
    const { url, username, password, path } = getWebDavParams();
    await webdavUpload(url, username, password, path);
    uiStore.notify('同步完成');
    await loadSyncStatus();
  } catch (err) {
    uiStore.notify('同步失败：' + String(err));
  } finally {
    syncLoading.value = false;
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
  uiStore.notify('AI 设置已保存');
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

function startEditSkill(id: number): void {
  const skill = aiStore.skills.find((s) => s.id === id);
  if (!skill) return;
  editingSkillId.value = id;
  editSkillSystemPrompt.value = skill.systemPrompt;
  editSkillUserPromptTemplate.value = skill.userPromptTemplate;
}

function cancelEditSkill(): void {
  editingSkillId.value = null;
}

async function saveEditSkill(): Promise<void> {
  if (editingSkillId.value == null) return;
  await aiStore.saveSkillPrompts(editingSkillId.value, editSkillSystemPrompt.value, editSkillUserPromptTemplate.value);
  editingSkillId.value = null;
  uiStore.notify('Skill prompt 已保存');
}

onMounted(() => {
  loadSyncStatus();
  loadPatterns();
});
</script>

<template>
  <div class="h-full p-6">
    <!-- Page Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-slate-800">设置</h1>
      <p class="mt-1 text-sm text-slate-500">自定义你的专注体验</p>
    </div>

    <div class="grid items-start gap-6 lg:grid-cols-[220px,minmax(0,1fr)] xl:gap-8">
      <!-- Settings Navigation -->
      <nav class="space-y-1 rounded-2xl border border-slate-200 bg-white/80 p-2 shadow-sm backdrop-blur-sm lg:sticky lg:top-4">
        <button
          v-for="tab in [
            { key: 'timer', label: '番茄钟', icon: 'timer' },
            { key: 'sync', label: '云同步', icon: 'sync' },
            { key: 'notifications', label: '通知', icon: 'notifications' },
            { key: 'patterns', label: '子任务模板', icon: 'patterns' },
            { key: 'ai', label: 'AI', icon: 'ai' },
            { key: 'data', label: '数据管理', icon: 'data' }
          ]"
          :key="tab.key"
          class="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          :class="activeTab === tab.key
            ? 'bg-blue-50 text-blue-600 shadow-sm'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'"
          @click="activeTab = tab.key as typeof activeTab"
        >
          <svg v-if="tab.icon === 'timer'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <svg v-else-if="tab.icon === 'sync'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <svg v-else-if="tab.icon === 'notifications'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <svg v-else-if="tab.icon === 'patterns'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <svg v-else-if="tab.icon === 'ai'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 3v2.25m4.5-2.25v2.25M4.5 9.75h15m-15 0a2.25 2.25 0 012.25-2.25h10.5A2.25 2.25 0 0119.5 9.75v7.5A2.25 2.25 0 0117.25 19.5H6.75A2.25 2.25 0 014.5 17.25v-7.5zm4.5 3h.008v.008H9v-.008zm0 3h.008v.008H9v-.008zm3-3h.008v.008H12v-.008zm0 3h.008v.008H12v-.008zm3-3h.008v.008H15v-.008zm0 3h.008v.008H15v-.008z" />
          </svg>
          <svg v-else-if="tab.icon === 'data'" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
          {{ tab.label }}
        </button>
      </nav>

      <!-- Settings Content -->
      <div class="min-w-0 w-full max-w-5xl">
        <!-- Timer Settings -->
        <div v-if="activeTab === 'timer'" class="space-y-6">
          <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div class="px-5 pt-5 pb-4">
              <h2 class="text-lg font-semibold text-slate-800">番茄钟时长</h2>
            </div>
            <div class="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
              <label class="space-y-1.5">
                <span class="text-sm font-medium text-slate-600">专注时长（分钟）</span>
                <input
                  v-model.number="focus"
                  type="number"
                  min="1"
                  max="120"
                  class="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>

              <label class="space-y-1.5">
                <span class="text-sm font-medium text-slate-600">短休息（分钟）</span>
                <input
                  v-model.number="shortBreak"
                  type="number"
                  min="1"
                  max="30"
                  class="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>

              <label class="space-y-1.5">
                <span class="text-sm font-medium text-slate-600">长休息（分钟）</span>
                <input
                  v-model.number="longBreak"
                  type="number"
                  min="1"
                  max="60"
                  class="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>

              <label class="space-y-1.5">
                <span class="text-sm font-medium text-slate-600">长休息间隔（番茄数）</span>
                <input
                  v-model.number="longBreakInterval"
                  type="number"
                  min="1"
                  max="10"
                  class="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>
            </div>
          </section>

          <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div class="px-5 pt-5 pb-3">
              <h2 class="text-lg font-semibold text-slate-800">自动化设置</h2>
            </div>
            <div class="divide-y divide-slate-100">
              <div class="flex items-center justify-between gap-4 px-5 py-3">
                <div class="min-w-0">
                  <span class="text-sm font-medium text-slate-700">自动开始休息</span>
                  <p class="text-xs text-slate-400">专注结束后自动开始休息计时</p>
                </div>
                <button
                  role="switch"
                  :aria-checked="autoStartBreak"
                  aria-label="自动开始休息"
                  class="relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  :class="autoStartBreak ? 'bg-blue-600' : 'bg-slate-200'"
                  @click="autoStartBreak = !autoStartBreak"
                >
                  <span
                    class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                    :class="autoStartBreak ? 'translate-x-4' : 'translate-x-0'"
                  />
                </button>
              </div>

              <div class="flex items-center justify-between gap-4 px-5 py-3 pb-4">
                <div class="min-w-0">
                  <span class="text-sm font-medium text-slate-700">自动开始下一个番茄</span>
                  <p class="text-xs text-slate-400">休息结束后自动开始新的专注</p>
                </div>
                <button
                  role="switch"
                  :aria-checked="autoStartNext"
                  aria-label="自动开始下一个番茄"
                  class="relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  :class="autoStartNext ? 'bg-blue-600' : 'bg-slate-200'"
                  @click="autoStartNext = !autoStartNext"
                >
                  <span
                    class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                    :class="autoStartNext ? 'translate-x-4' : 'translate-x-0'"
                  />
                </button>
              </div>
            </div>
          </section>
        </div>

        <!-- Sync Settings -->
        <div v-else-if="activeTab === 'sync'" class="space-y-6">
          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-4 text-lg font-semibold text-slate-800">WebDAV 云同步</h2>
            <p class="mb-4 text-sm text-slate-500">
              配置 WebDAV 服务器以在多设备间同步你的数据。支持坚果云、Nextcloud 等服务。
            </p>

            <div class="space-y-4">
              <label class="block">
                <span class="mb-1 block text-sm font-medium text-slate-700">服务器地址</span>
                <input
                  v-model="settingsStore.webdav.url"
                  type="url"
                  placeholder="https://dav.example.com/webdav/"
                  class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>

              <div class="grid gap-4 sm:grid-cols-2">
                <label class="block">
                  <span class="mb-1 block text-sm font-medium text-slate-700">用户名</span>
                  <input
                    v-model="settingsStore.webdav.username"
                    type="text"
                    class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </label>

                <label class="block">
                  <span class="mb-1 block text-sm font-medium text-slate-700">密码</span>
                  <input
                    v-model="settingsStore.webdav.password"
                    type="password"
                    class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </label>
              </div>

              <label class="block">
                <span class="mb-1 block text-sm font-medium text-slate-700">同步路径</span>
                <input
                  v-model="settingsStore.webdav.path"
                  type="text"
                  class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>

              <div class="flex items-center gap-4 pt-2">
                <button
                  class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="syncLoading"
                  @click="saveWebDavSettings"
                >
                  保存设置
                </button>
                <button
                  class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="syncStatus === 'testing' || syncLoading"
                  @click="testConnection"
                >
                  {{ syncStatus === 'testing' ? '测试中…' : '测试连接' }}
                </button>
              </div>
              <p v-if="syncMessage" class="mt-2 text-xs" :class="syncStatus === 'success' ? 'text-green-600' : syncStatus === 'error' ? 'text-red-500' : 'text-slate-500'">
                {{ syncMessage }}
              </p>
            </div>
          </section>

          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-4 text-lg font-semibold text-slate-800">同步操作</h2>
            <div class="flex flex-wrap gap-3">
              <button
                class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="syncLoading"
                @click="syncNow"
              >
                {{ syncLoading ? '同步中…' : '立即同步' }}
              </button>
              <button
                class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="syncLoading"
                @click="handleUpload"
              >
                上传到云端
              </button>
              <template v-if="!showDownloadConfirm">
                <button
                  class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="syncLoading"
                  @click="showDownloadConfirm = true"
                >
                  从云端下载
                </button>
              </template>
              <template v-else>
                <button
                  class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="syncLoading"
                  @click="handleDownload"
                >
                  确认下载（将覆盖本地数据）
                </button>
                <button
                  class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  @click="showDownloadConfirm = false"
                >
                  取消
                </button>
              </template>
            </div>
            <p class="mt-4 text-xs text-slate-500">
              最后同步时间：{{ formatSyncTime(lastSyncAt) }}
            </p>
          </section>
        </div>

        <!-- Notifications Settings -->
        <div v-else-if="activeTab === 'notifications'" class="space-y-6">
          <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div class="px-5 pt-5 pb-3">
              <h2 class="text-lg font-semibold text-slate-800">通知设置</h2>
              <p class="mt-0.5 text-sm text-slate-500">控制系统通知的触发时机，避免打断同时保留关键提醒。</p>
            </div>

            <div class="divide-y divide-slate-100">
              <div class="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-slate-50/60">
                <div class="min-w-0">
                  <span class="text-sm font-medium text-slate-700">番茄钟开始通知</span>
                  <p class="text-xs text-slate-400">开始专注时发送通知</p>
                </div>
                <button
                  role="switch"
                  :aria-checked="notifyStart"
                  aria-label="番茄钟开始通知"
                  class="relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  :class="notifyStart ? 'bg-blue-600' : 'bg-slate-200'"
                  @click="notifyStart = !notifyStart"
                >
                  <span
                    class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                    :class="notifyStart ? 'translate-x-4' : 'translate-x-0'"
                  />
                </button>
              </div>

              <div class="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-slate-50/60">
                <div class="min-w-0">
                  <span class="text-sm font-medium text-slate-700">番茄钟结束通知</span>
                  <p class="text-xs text-slate-400">专注结束时发送通知</p>
                </div>
                <button
                  role="switch"
                  :aria-checked="notifyEnd"
                  aria-label="番茄钟结束通知"
                  class="relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  :class="notifyEnd ? 'bg-blue-600' : 'bg-slate-200'"
                  @click="notifyEnd = !notifyEnd"
                >
                  <span
                    class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                    :class="notifyEnd ? 'translate-x-4' : 'translate-x-0'"
                  />
                </button>
              </div>

              <div class="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-slate-50/60">
                <div class="min-w-0">
                  <span class="text-sm font-medium text-slate-700">休息结束通知</span>
                  <p class="text-xs text-slate-400">休息结束时发送通知</p>
                </div>
                <button
                  role="switch"
                  :aria-checked="notifyBreakEnd"
                  aria-label="休息结束通知"
                  class="relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  :class="notifyBreakEnd ? 'bg-blue-600' : 'bg-slate-200'"
                  @click="notifyBreakEnd = !notifyBreakEnd"
                >
                  <span
                    class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                    :class="notifyBreakEnd ? 'translate-x-4' : 'translate-x-0'"
                  />
                </button>
              </div>

              <div class="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-slate-50/60">
                <div class="min-w-0">
                  <span class="text-sm font-medium text-slate-700">任务截止提醒</span>
                  <p class="text-xs text-slate-400">任务即将截止时发送提醒</p>
                </div>
                <button
                  role="switch"
                  :aria-checked="notifyDeadline"
                  aria-label="任务截止提醒"
                  class="relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  :class="notifyDeadline ? 'bg-blue-600' : 'bg-slate-200'"
                  @click="notifyDeadline = !notifyDeadline"
                >
                  <span
                    class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                    :class="notifyDeadline ? 'translate-x-4' : 'translate-x-0'"
                  />
                </button>
              </div>
            </div>

            <!-- Test notification merged as section footer -->
            <div class="flex items-center gap-3 border-t border-slate-100 px-5 py-3">
              <button
                class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                @click="testNotification"
              >
                发送测试通知
              </button>
              <span class="text-xs text-slate-400">验证通知功能是否正常</span>
            </div>
          </section>
        </div>

        <!-- Subtask Pattern Templates -->
        <div v-else-if="activeTab === 'patterns'" class="space-y-6">
          <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div class="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <h2 class="text-lg font-semibold text-slate-800">子任务模板</h2>
                <p class="mt-0.5 text-sm text-slate-500">预设常见场景的检查清单，创建任务时自动匹配建议。</p>
              </div>
              <button
                class="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                @click="openNewPatternForm"
              >
                新增模板
              </button>
            </div>

            <!-- Pattern form -->
            <div v-if="showPatternForm" class="mx-6 mb-4 rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3">
              <label class="block space-y-1">
                <span class="text-xs font-medium text-slate-700">模板名称</span>
                <input
                  v-model.trim="patternFormName"
                  type="text"
                  placeholder="如：健身运动"
                  class="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
              </label>
              <label class="block space-y-1">
                <span class="text-xs font-medium text-slate-700">匹配关键词</span>
                <input
                  v-model.trim="patternFormKeywords"
                  type="text"
                  placeholder="健身、锻炼、运动、gym（用顿号或逗号分隔）"
                  class="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                <p class="text-[10px] text-slate-400">任务标题中包含以上任意关键词即命中此模板</p>
              </label>
              <label class="block space-y-1">
                <span class="text-xs font-medium text-slate-700">子任务清单</span>
                <input
                  v-model.trim="patternFormSubtasks"
                  type="text"
                  placeholder="水杯、运动鞋、毛巾（用顿号或逗号分隔）"
                  class="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
              </label>
              <div class="flex gap-2 pt-1">
                <button
                  class="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                  @click="savePattern"
                >
                  {{ editingPatternId ? '更新' : '创建' }}
                </button>
                <button
                  class="rounded-md border border-slate-200 px-3.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50"
                  @click="cancelPatternForm"
                >
                  取消
                </button>
              </div>
            </div>

            <!-- Pattern list -->
            <div v-if="patterns.length === 0 && !showPatternForm" class="px-6 pb-5 text-sm text-slate-400">
              暂无模板。启动桌面端后自动加载内置模板，也可手动创建。
            </div>
            <div v-else class="divide-y divide-slate-100">
              <div
                v-for="p in patterns"
                :key="p.id"
                class="px-6 py-4"
              >
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-semibold text-slate-700">{{ p.name }}</span>
                      <span v-if="p.isBuiltin" class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">内置</span>
                      <span v-if="p.usageCount > 0" class="text-[10px] text-slate-400">已用 {{ p.usageCount }} 次</span>
                    </div>
                    <div class="mt-1.5 flex flex-wrap gap-1">
                      <span
                        v-for="kw in p.keywords"
                        :key="kw"
                        class="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600"
                      >
                        {{ kw }}
                      </span>
                    </div>
                    <div class="mt-1.5 flex flex-wrap gap-1.5">
                      <span
                        v-for="st in p.subtasks"
                        :key="st"
                        class="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600"
                      >
                        {{ st }}
                      </span>
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <button
                      class="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                      @click="openEditPatternForm(p)"
                    >
                      编辑
                    </button>
                    <button
                      class="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
                      @click="removePattern(p.id)"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-2 text-lg font-semibold text-slate-800">工作原理</h2>
            <ul class="space-y-2 text-sm text-slate-600">
              <li>创建任务时，系统自动从任务标题提取关键词与模板匹配。</li>
              <li>匹配成功后即时建议子任务清单（无需等待 AI）。</li>
              <li>你确认或拒绝的子任务会被记录，系统会逐渐学习你的偏好。</li>
              <li>模板和学习数据均无匹配时，才会调用 AI 生成建议。</li>
            </ul>
          </section>
        </div>

        <!-- AI Settings -->
        <div v-else-if="activeTab === 'ai'" class="space-y-6">
          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-2 text-lg font-semibold text-slate-800">AI 连接配置</h2>
            <p class="mb-4 text-sm text-slate-500">
              可选配置。当模板和学习数据均无匹配时，系统会调用 AI 生成子任务建议。
            </p>
            <div class="space-y-4">
              <label class="block space-y-1.5">
                <span class="text-sm font-medium text-slate-700">API Endpoint</span>
                <input
                  v-model.trim="settingsStore.ai.endpoint"
                  type="text"
                  placeholder="https://api.openai.com/v1/chat/completions"
                  class="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
              </label>
              <label class="block space-y-1.5">
                <span class="text-sm font-medium text-slate-700">API Key</span>
                <input
                  v-model.trim="settingsStore.ai.apiKey"
                  type="password"
                  placeholder="输入你的 API Key"
                  class="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
              </label>
              <label class="block space-y-1.5">
                <span class="text-sm font-medium text-slate-700">Model</span>
                <input
                  v-model.trim="settingsStore.ai.model"
                  type="text"
                  placeholder="gpt-4o-mini"
                  class="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
              </label>
            </div>

            <div class="mt-5 flex items-center gap-3">
              <button
                class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                @click="saveAiSettings"
              >
                保存 AI 设置
              </button>
              <span class="text-xs text-slate-400">建议优先使用专用模型与独立额度</span>
            </div>
          </section>

          <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div class="px-5 pt-5 pb-4">
              <h2 class="text-lg font-semibold text-slate-800">子任务拆解粒度</h2>
              <p class="mt-0.5 text-sm text-slate-500">控制 AI 生成子任务的数量和详细程度</p>
            </div>
            <div class="flex gap-2 px-5 pb-5">
              <button
                v-for="level in [
                  { key: 'simple', label: '简洁', desc: '1-2 个关键步骤' },
                  { key: 'normal', label: '一般', desc: '2-4 个实用步骤' },
                  { key: 'detailed', label: '详细', desc: '4-8 个完整步骤' },
                ]"
                :key="level.key"
                class="flex flex-1 flex-col items-center gap-1 rounded-xl border-2 px-3 py-3 text-center transition-all"
                :class="settingsStore.ai.detailLevel === level.key
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'"
                @click="settingsStore.updateAi({ detailLevel: level.key as 'simple' | 'normal' | 'detailed' })"
              >
                <span class="text-sm font-semibold">{{ level.label }}</span>
                <span class="text-[11px]" :class="settingsStore.ai.detailLevel === level.key ? 'text-blue-500' : 'text-slate-400'">{{ level.desc }}</span>
              </button>
            </div>
          </section>

          <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div class="px-6 pt-5 pb-3">
              <h2 class="text-lg font-semibold text-slate-800">AI 技能</h2>
              <p class="mt-0.5 text-sm text-slate-500">管理 AI 技能，可启用/禁用或编辑 Prompt。</p>
            </div>
            <div v-if="aiStore.skills.length === 0" class="px-6 pb-5 text-sm text-slate-400">
              暂无已注册的 AI 技能。启动桌面端后自动加载。
            </div>
            <div v-else class="divide-y divide-slate-100">
              <div
                v-for="skill in aiStore.skills"
                :key="skill.id"
                class="px-6 py-4"
              >
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-semibold text-slate-700">{{ skill.name }}</span>
                      <span v-if="skill.isBuiltin" class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">内置</span>
                      <span class="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">{{ skill.triggerType }}</span>
                    </div>
                    <p v-if="skill.description" class="mt-0.5 text-xs text-slate-500">{{ skill.description }}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      class="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                      @click="startEditSkill(skill.id)"
                    >
                      编辑
                    </button>
                    <button
                      role="switch"
                      :aria-checked="skill.enabled"
                      :aria-label="'启用 ' + skill.name"
                      class="relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      :class="skill.enabled ? 'bg-blue-600' : 'bg-slate-200'"
                      @click="aiStore.toggleSkill(skill.id, !skill.enabled)"
                    >
                      <span
                        class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                        :class="skill.enabled ? 'translate-x-4' : 'translate-x-0'"
                      />
                    </button>
                  </div>
                </div>

                <!-- Edit form -->
                <div v-if="editingSkillId === skill.id" class="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <label class="block space-y-1">
                    <span class="text-xs font-medium text-slate-600">System Prompt</span>
                    <textarea
                      v-model="editSkillSystemPrompt"
                      rows="4"
                      class="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </label>
                  <label class="block space-y-1">
                    <span class="text-xs font-medium text-slate-600">User Prompt 模板</span>
                    <textarea
                      v-model="editSkillUserPromptTemplate"
                      rows="3"
                      class="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <p class="text-[10px] text-slate-400">支持 {<!-- -->{variable}} 变量替换</p>
                  </label>
                  <div class="flex gap-2">
                    <button
                      class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                      @click="saveEditSkill"
                    >
                      保存
                    </button>
                    <button
                      class="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50"
                      @click="cancelEditSkill"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-2 text-lg font-semibold text-slate-800">工作流程</h2>
            <ul class="space-y-2 text-sm text-slate-600">
              <li>创建任务后，优先匹配子任务模板和学习数据（即时响应）。</li>
              <li>无本地匹配时，AI 异步分析并生成子任务建议。</li>
              <li>AI 建议通过通知中心展示，需确认后才会创建子任务。</li>
              <li>确认/拒绝的子任务会反馈到学习系统，逐步提升建议质量。</li>
              <li>未配置 API 或禁用技能时，仅使用模板和学习数据。</li>
            </ul>
          </section>
        </div>

        <!-- Data Management -->
        <div v-else-if="activeTab === 'data'" class="space-y-6">
          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-4 text-lg font-semibold text-slate-800">数据导出</h2>
            <p class="mb-4 text-sm text-slate-500">
              导出你的所有数据，包括任务、专注记录等。
            </p>
            <div class="flex flex-wrap items-center gap-3">
              <button
                class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="exportStatus === 'exporting'"
                @click="handleExportToFile"
              >
                {{ exportStatus === 'exporting' ? '导出中…' : '导出到文件' }}
              </button>
              <button
                class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="exportStatus === 'exporting'"
                @click="handleExportJson"
              >
                导出到应用目录
              </button>
            </div>
            <p v-if="exportStatus === 'done'" class="mt-3 text-xs text-green-600">
              已导出至：{{ exportPath }}
            </p>
          </section>

          <section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-4 text-lg font-semibold text-slate-800">数据导入</h2>
            <p class="mb-4 text-sm text-slate-500">
              从之前导出的 JSON 文件恢复数据。导入将覆盖当前所有数据。
            </p>
            <button
              class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="importStatus === 'importing'"
              @click="handleImportFromFile"
            >
              {{ importStatus === 'importing' ? '导入中…' : '从文件导入' }}
            </button>
          </section>

          <section class="rounded-xl border border-red-200 bg-red-50 p-6">
            <h2 class="mb-2 text-lg font-semibold text-red-800">危险区域</h2>
            <p class="mb-4 text-sm text-red-600">
              以下操作不可撤销，请谨慎操作。
            </p>
            <template v-if="!showClearConfirm">
              <button
                class="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                @click="showClearConfirm = true"
              >
                清空所有数据
              </button>
            </template>
            <template v-else>
              <p class="mb-3 text-sm font-medium text-red-700">确定要清空所有数据吗？此操作不可撤销。</p>
              <div class="flex gap-3">
                <button
                  class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  @click="showClearConfirm = false"
                >
                  取消
                </button>
                <button
                  class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="clearStatus === 'clearing'"
                  @click="handleClearAll"
                >
                  {{ clearStatus === 'clearing' ? '清空中…' : '确认清空' }}
                </button>
              </div>
            </template>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
