<script setup lang="ts">
console.time('[app] script setup → mounted');
import { ref, computed, watch, onMounted } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';

import { APP_NAME } from './utils/constants';
import { useTimerStore } from './stores/timerStore';
import { useTaskStore } from './stores/taskStore';
import { useSettingsStore } from './stores/settingsStore';
import { useUiStore } from './stores/uiStore';
import { useAiStore } from './stores/aiStore';
import { appInit, taskListInit } from './services/commands/init';
import { useFocusModal } from './composables/useFocusModal';
import FocusModal from './components/FocusModal.vue';
import AppFeedbackLayer from './components/AppFeedbackLayer.vue';
import ProjectContextMenu from './components/ProjectContextMenu.vue';
import ProjectFormPopover from './components/ProjectFormPopover.vue';
import NotificationCenter from './components/NotificationCenter.vue';
import type { ProjectItem } from './types/domain';
import { ensureNotificationPermission } from './services/notification';
import { webdavUpload, webdavDownload } from './services/commands/sync';
import { toDateKey, getDateKeyFromToday, isDateInRecent7Days } from './utils/date';
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();
const isMaximized = ref(false);

appWindow.onResized(async () => {
  isMaximized.value = await appWindow.isMaximized();
});

const isTauri = '__TAURI_INTERNALS__' in window;

// Fire IPC call immediately during script setup, don't wait for onMounted
console.time('[init] appInit');
const initPromise = isTauri ? appInit() : null;

const route = useRoute();
const router = useRouter();
const timerStore = useTimerStore();
const taskStore = useTaskStore();
const settingsStore = useSettingsStore();
const uiStore = useUiStore();
const aiStore = useAiStore();

onMounted(async () => {
  console.timeEnd('[app] script setup → mounted');
  if (!initPromise) return;
  const [data, taskData] = await Promise.all([initPromise, taskListInit(0, 500)]);
  console.timeEnd('[init] appInit');
  settingsStore.loadFromData(data.settings);
  taskStore.loadFromData(taskData.tasks);
  taskStore.loadProjectsFromData(data.projects);
  taskStore.loadRecurringRulesFromData(data.recurringRules);
  taskStore.startDeadlineWatcher();
  ensureNotificationPermission().catch(console.error);
  aiStore.init().catch(console.error);
});

// Modal states
const { visible: showFocusModal, open: openFocusModal, close: closeFocusModal } = useFocusModal();

// Reset scroll position on route change
const mainRef = ref<HTMLElement | null>(null);
watch(() => route.path, () => {
  if (mainRef.value) mainRef.value.scrollTop = 0;
});

// Sidebar collapse
const sidebarCollapsed = ref(false);

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

// Smart lists - 智能列表（借鉴 Focus To-Do）
const smartLists = [
  { path: '/tasks/today', name: 'today', label: '今天', icon: 'sun', color: 'text-amber-500' },
  { path: '/tasks/all', name: 'all', label: '全部', icon: 'inbox', color: 'text-slate-500' },
];

const isActive = (path: string) => route.path === path;
const isSmartListActive = () => route.path.startsWith('/tasks/');
const noMainBottomPaddingRoutes = new Set(['today', 'all', 'project']);
const mainNeedsBottomPadding = computed(() => !noMainBottomPaddingRoutes.has(String(route.name || '')));


// Get task counts
const getTaskCount = (filter: string) => {
  const tasks = taskStore.tasks.filter(task => task.parentId === null);
  switch (filter) {
    case 'today':
      return tasks.filter(t => t.status === 'todo' && t.dueAt === getDateKeyFromToday(0)).length;
    case 'all':
      return tasks.filter(t => t.status !== 'cancelled').length;
    default:
      return 0;
  }
};

const getProjectTaskCount = (projectId: number) => {
  return taskStore.tasks.filter(task => task.parentId === null && task.projectId === projectId && task.status === 'todo').length;
};


// WebDAV sync
const syncing = ref(false);
const downloading = ref(false);

async function handleWebDavSync(): Promise<void> {
  const { url, username, password, path } = settingsStore.webdav;
  if (!url || syncing.value) return;
  syncing.value = true;
  try {
    await webdavUpload(url, username, password, path);
    uiStore.notify('同步成功');
  } catch (e: any) {
    uiStore.notify(`同步失败：${e?.message || e}`, 5000);
  } finally {
    syncing.value = false;
  }
}

async function handleWebDavDownload(): Promise<void> {
  const { url, username, password, path } = settingsStore.webdav;
  if (!url || downloading.value) return;
  const confirmed = await uiStore.confirm(
    '从云端拉取将覆盖本地数据（已自动备份），确定继续？',
    { title: '拉取云端数据', confirmText: '确认拉取' },
  );
  if (!confirmed) return;
  downloading.value = true;
  try {
    const msg = await webdavDownload(url, username, password, path);
    uiStore.notify(msg + '，页面即将刷新…');
    setTimeout(() => window.location.reload(), 1000);
  } catch (e: any) {
    uiStore.notify(`拉取失败：${e?.message || e}`, 5000);
  } finally {
    downloading.value = false;
  }
}

// Project management state
const showProjectForm = ref(false);
const projectFormAnchorEl = ref<HTMLElement | null>(null);
const editingProject = ref<ProjectItem | null>(null);
const showProjectContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuProject = ref<ProjectItem | null>(null);

function openCreateProject(event: MouseEvent) {
  editingProject.value = null;
  projectFormAnchorEl.value = event.currentTarget as HTMLElement;
  showProjectForm.value = true;
}

function onProjectContextMenu(event: MouseEvent, project: ProjectItem) {
  if (project.id === 1) return; // Protect inbox
  event.preventDefault();
  contextMenuX.value = event.clientX;
  contextMenuY.value = event.clientY;
  contextMenuProject.value = project;
  showProjectContextMenu.value = true;
}

function handleProjectContextAction(key: string) {
  const project = contextMenuProject.value;
  if (!project) return;
  if (key === 'edit') {
    editingProject.value = project;
    // Anchor to the project link element
    const el = document.querySelector(`[data-project-id="${project.id}"]`) as HTMLElement | null;
    projectFormAnchorEl.value = el;
    showProjectForm.value = true;
  } else if (key === 'delete') {
    void confirmDeleteProject(project);
  }
}

async function confirmDeleteProject(project: ProjectItem): Promise<void> {
  const taskCount = taskStore.tasks.filter(t => t.projectId === project.id && t.status === 'todo').length;
  const message = taskCount > 0
    ? `确定删除清单「${project.title}」吗？其中 ${taskCount} 个任务将移至收集箱。`
    : `确定删除清单「${project.title}」吗？`;
  const confirmed = await uiStore.confirm(message, { title: '删除清单', confirmText: '删除' });
  if (!confirmed) return;
  // Navigate away if viewing the deleted project
  if (route.path === `/project/${project.id}`) {
    router.push('/tasks/all');
  }
  taskStore.removeProject(project.id);
}

async function handleProjectFormSave(data: { title: string; color: string }) {
  if (editingProject.value) {
    await taskStore.updateProject(editingProject.value.id, { title: data.title, color: data.color });
  } else {
    await taskStore.addProject(data.title, data.color);
  }
  showProjectForm.value = false;
}

const focusButtonTime = computed(() => {
  if (timerStore.running || timerStore.paused) return timerStore.display;
  return String(Math.max(1, Math.round(timerStore.remainingSeconds / 60)));
});

const focusButtonLabel = computed(() => {
  if (timerStore.currentTaskTitle) return timerStore.currentTaskTitle;
  if (timerStore.running) return '专注中';
  if (timerStore.paused) return '已暂停';
  return '开始专注';
});

const focusButtonSubLabel = computed(() => {
  if (timerStore.running) return '专注进行中';
  if (timerStore.paused) return '已暂停，点击继续管理';
  return '打开专注面板';
});

const focusButtonTone = computed(() => {
  if (timerStore.running) {
    return {
      shell: 'border-slate-700/80 bg-slate-900/95',
      chip: 'border-emerald-300/30 bg-emerald-500/15 text-emerald-100',
      subLabel: 'text-emerald-200/80',
      pulse: 'bg-emerald-300',
      arrow: 'bg-emerald-500/20 ring-1 ring-emerald-300/35',
    };
  }
  if (timerStore.paused) {
    return {
      shell: 'border-slate-700/80 bg-slate-900/95',
      chip: 'border-amber-300/30 bg-amber-500/15 text-amber-100',
      subLabel: 'text-amber-200/80',
      pulse: 'bg-amber-200',
      arrow: 'bg-amber-500/20 ring-1 ring-amber-300/35',
    };
  }
  return {
    shell: 'border-slate-700/80 bg-slate-900/95',
    chip: 'border-sky-300/30 bg-sky-500/15 text-sky-100',
    subLabel: 'text-slate-300/80',
    pulse: 'bg-sky-200',
    arrow: 'bg-slate-700/70 ring-1 ring-white/20',
  };
});
</script>

<template>
  <div class="flex h-screen bg-slate-50">
    <!-- Sidebar -->
    <aside
      class="flex flex-col border-r border-slate-200 bg-white transition-[width] duration-200"
      :class="sidebarCollapsed ? 'w-16' : 'w-60'"
    >
      <!-- App Brand -->
      <div class="flex items-center border-b border-slate-100 px-3 py-3" :class="sidebarCollapsed ? 'justify-center' : 'gap-3 px-4'" data-tauri-drag-region>
        <button
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-sm"
          aria-label="收起/展开侧边栏"
          @click="toggleSidebar"
        >
          <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
        </button>
        <div v-if="!sidebarCollapsed">
          <h1 class="text-sm font-semibold text-slate-800">{{ APP_NAME }}</h1>
          <p class="text-xs text-slate-400">专注追踪</p>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 overflow-auto px-2 py-3" :class="sidebarCollapsed ? 'px-1.5' : 'px-3'">
        <!-- Dashboard - 仪表盘 -->
        <RouterLink
          to="/"
          class="mb-2 flex items-center rounded-lg text-sm font-medium transition-colors"
          :class="[
            sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
            isActive('/')
              ? 'bg-red-50 text-red-600'
              : 'text-slate-600 hover:bg-slate-50'
          ]"
          :title="sidebarCollapsed ? '仪表盘' : undefined"
        >
          <svg class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <span v-if="!sidebarCollapsed">仪表盘</span>
        </RouterLink>

        <!-- Smart Lists Section - 智能列表 -->
        <div class="mb-2">
          <div v-if="!sidebarCollapsed" class="mb-1 px-3 text-xs font-medium text-slate-400">任务</div>
          <div v-else class="mb-1 border-t border-slate-100 pt-1" />
          <RouterLink
            v-for="item in smartLists"
            :key="item.path"
            :to="item.path"
            class="flex items-center rounded-lg text-sm transition-colors"
            :class="[
              sidebarCollapsed ? 'justify-center px-0 py-2' : 'justify-between px-3 py-2',
              isActive(item.path)
                ? 'bg-slate-100 text-slate-900'
                : 'text-slate-600 hover:bg-slate-50'
            ]"
            :title="sidebarCollapsed ? item.label : undefined"
          >
            <div class="flex items-center" :class="sidebarCollapsed ? '' : 'gap-3'">
              <!-- Sun icon -->
              <svg v-if="item.icon === 'sun'" class="h-4 w-4 shrink-0" :class="item.color" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <!-- Sunrise icon -->
              <svg v-else-if="item.icon === 'sunrise'" class="h-4 w-4 shrink-0" :class="item.color" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 7a5 5 0 015 5H7a5 5 0 015-5zM3 17h18M5.636 7.636l1.414 1.414M12 3v2m6.364 2.636l-1.414 1.414" />
              </svg>
              <!-- Calendar icon -->
              <svg v-else-if="item.icon === 'calendar'" class="h-4 w-4 shrink-0" :class="item.color" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <!-- Inbox icon -->
              <svg v-else-if="item.icon === 'inbox'" class="h-4 w-4 shrink-0" :class="item.color" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <!-- Check icon -->
              <svg v-else-if="item.icon === 'check'" class="h-4 w-4 shrink-0" :class="item.color" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span v-if="!sidebarCollapsed">{{ item.label }}</span>
            </div>
            <span v-if="!sidebarCollapsed && getTaskCount(item.name)" class="text-xs text-slate-400">{{ getTaskCount(item.name) }}</span>
          </RouterLink>
        </div>

        <!-- Projects Section - 清单 -->
        <div class="mb-2">
          <div v-if="!sidebarCollapsed" class="mb-1 flex items-center justify-between px-3">
            <span class="text-xs font-medium text-slate-400">清单</span>
            <button class="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="新增清单" @click="openCreateProject($event)">
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
          <div v-else class="mb-1 border-t border-slate-100 pt-1" />
          <RouterLink
            v-for="project in taskStore.projects"
            :key="project.id"
            :to="`/project/${project.id}`"
            :data-project-id="project.id"
            class="flex items-center rounded-lg text-sm transition-colors"
            :class="[
              sidebarCollapsed ? 'justify-center px-0 py-2' : 'justify-between px-3 py-2',
              isActive(`/project/${project.id}`)
                ? 'bg-slate-100 text-slate-900'
                : 'text-slate-600 hover:bg-slate-50'
            ]"
            :title="sidebarCollapsed ? project.title : undefined"
            @contextmenu="onProjectContextMenu($event, project)"
          >
            <div class="flex items-center" :class="sidebarCollapsed ? '' : 'gap-3'">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: project.color || '#6b7280' }" />
              <span v-if="!sidebarCollapsed">{{ project.title }}</span>
            </div>
            <span v-if="!sidebarCollapsed" class="text-xs text-slate-400">{{ getProjectTaskCount(project.id) }}</span>
          </RouterLink>
        </div>
      </nav>

      <!-- Bottom toolbar: Notification, Settings, Sync -->
      <div class="border-t border-slate-100 p-3" :class="sidebarCollapsed ? 'px-1.5' : ''">
        <div
          class="flex items-center rounded-lg"
          :class="sidebarCollapsed ? 'flex-col gap-2 px-0 py-2' : 'gap-1 px-2 py-1.5'"
        >
          <NotificationCenter />
          <RouterLink
            to="/settings"
            class="flex items-center justify-center rounded-lg px-2 py-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            :class="isActive('/settings') ? 'bg-slate-100 text-slate-900' : ''"
            :title="'设置'"
            aria-label="设置"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </RouterLink>
          <template v-if="!sidebarCollapsed">
            <button
              class="flex items-center justify-center rounded-lg px-2 py-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              :class="{ 'animate-pulse text-blue-500': syncing }"
              :disabled="syncing || !settingsStore.webdav.url"
              :title="settingsStore.webdav.url ? '上传到云端' : '请先在设置中配置 WebDAV'"
              aria-label="WebDAV 上传"
              @click="handleWebDavSync"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </button>
            <button
              class="flex items-center justify-center rounded-lg px-2 py-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              :class="{ 'animate-pulse text-blue-500': downloading }"
              :disabled="downloading || !settingsStore.webdav.url"
              :title="settingsStore.webdav.url ? '从云端拉取' : '请先在设置中配置 WebDAV'"
              aria-label="WebDAV 拉取"
              @click="handleWebDavDownload"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            </button>
            <span v-if="syncing || downloading" class="ml-1 text-xs text-slate-400">{{ syncing ? '上传中…' : '拉取中…' }}</span>
          </template>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Custom Titlebar (drag region) -->
      <div class="flex h-9 shrink-0 items-center justify-end" data-tauri-drag-region>
        <div class="flex items-center">
          <button class="flex h-9 w-11 items-center justify-center text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600" title="最小化" @click="appWindow.minimize()">
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="M5 12h14" /></svg>
          </button>
          <button class="flex h-9 w-11 items-center justify-center text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600" :title="isMaximized ? '还原' : '最大化'" @click="appWindow.toggleMaximize()">
            <svg v-if="isMaximized" class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" d="M8 4h12a1 1 0 011 1v12M4 8h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" /></svg>
            <svg v-else class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2" /></svg>
          </button>
          <button class="flex h-9 w-11 items-center justify-center text-slate-400 transition-colors hover:bg-red-500 hover:text-white" title="关闭" @click="appWindow.close()">
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="M6 6l12 12M6 18L18 6" /></svg>
          </button>
        </div>
      </div>
      <!-- Router View -->
      <main ref="mainRef" class="flex-1 overflow-auto" :class="mainNeedsBottomPadding ? 'pb-20' : 'pb-0'">
        <RouterView />
      </main>
    </div>

    <!-- Bottom Focus Button -->
    <div class="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <button
        class="pointer-events-auto group relative inline-flex w-full max-w-[21rem] items-center gap-3 overflow-hidden rounded-full border border-slate-700/70 px-3 py-2.5 text-white shadow-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
        :class="focusButtonTone.shell"
        @click="openFocusModal"
      >
        <div
          class="relative flex h-10 min-w-[4.75rem] items-center justify-center rounded-xl border px-2.5 font-mono text-lg font-semibold leading-none tabular-nums tracking-tight"
          :class="focusButtonTone.chip"
        >
          {{ focusButtonTime }}
        </div>

        <div class="relative min-w-0 flex-1 text-left">
          <p class="truncate text-sm font-semibold leading-tight text-white/95">
            {{ focusButtonLabel }}
          </p>
          <p class="mt-0.5 text-[11px] font-medium" :class="focusButtonTone.subLabel">
            {{ focusButtonSubLabel }}
          </p>
        </div>

        <div class="relative flex items-center gap-2 pr-1">
          <span class="h-2 w-2 rounded-full opacity-90" :class="focusButtonTone.pulse" />
          <span class="flex h-8 w-8 items-center justify-center rounded-full transition-colors group-hover:bg-white/16" :class="focusButtonTone.arrow">
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </div>
      </button>
    </div>

    <!-- Focus Modal (always mounted, visibility managed internally) -->
    <FocusModal />

    <!-- Project Context Menu -->
    <ProjectContextMenu
      v-if="showProjectContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :items="[
        { key: 'edit', label: '编辑' },
        { key: 'delete', label: '删除', danger: true },
      ]"
      @select="handleProjectContextAction"
      @close="showProjectContextMenu = false"
    />

    <!-- Project Form Popover -->
    <ProjectFormPopover
      v-if="showProjectForm"
      :project="editingProject"
      :anchor-el="projectFormAnchorEl"
      @save="handleProjectFormSave"
      @close="showProjectForm = false"
    />

    <AppFeedbackLayer />
  </div>
</template>
