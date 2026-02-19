<script setup lang="ts">
console.time('[app] script setup → mounted');
import { ref, computed, onMounted } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';

import { APP_NAME } from './utils/constants';
import { useTimerStore } from './stores/timerStore';
import { useTaskStore } from './stores/taskStore';
import { useSettingsStore } from './stores/settingsStore';
import { appInit } from './services/commands/init';
import FocusModal from './components/FocusModal.vue';
import ProjectContextMenu from './components/ProjectContextMenu.vue';
import ProjectFormPopover from './components/ProjectFormPopover.vue';
import type { ProjectItem } from './types/domain';

const isTauri = '__TAURI_INTERNALS__' in window;

// Fire IPC call immediately during script setup, don't wait for onMounted
console.time('[init] appInit');
const initPromise = isTauri ? appInit() : null;

const route = useRoute();
const router = useRouter();
const timerStore = useTimerStore();
const taskStore = useTaskStore();
const settingsStore = useSettingsStore();

onMounted(async () => {
  console.timeEnd('[app] script setup → mounted');
  if (!initPromise) return;
  const data = await initPromise;
  console.timeEnd('[init] appInit');
  settingsStore.loadFromData(data.settings);
  taskStore.loadFromData(data.tasks);
  taskStore.loadProjectsFromData(data.projects);
  taskStore.loadRecurringRulesFromData(data.recurringRules);
});

// Modal states
const showFocusModal = ref(false);

// Sidebar collapse
const sidebarCollapsed = ref(false);

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

// Smart lists - 智能列表（借鉴 Focus To-Do）
const smartLists = [
  { path: '/tasks/today', name: 'today', label: '今天', icon: 'sun', color: 'text-amber-500' },
  { path: '/tasks/tomorrow', name: 'tomorrow', label: '明天', icon: 'sunrise', color: 'text-orange-400' },
  { path: '/tasks/week', name: 'week', label: '最近7天', icon: 'calendar', color: 'text-blue-500' },
  { path: '/tasks/all', name: 'all', label: '全部', icon: 'inbox', color: 'text-slate-500' },
  { path: '/tasks/completed', name: 'completed', label: '已完成', icon: 'check', color: 'text-green-500' },
];

const isActive = (path: string) => route.path === path;
const isSmartListActive = () => route.path.startsWith('/tasks/');
const noMainBottomPaddingRoutes = new Set(['today', 'tomorrow', 'week', 'all', 'completed', 'project']);
const mainNeedsBottomPadding = computed(() => !noMainBottomPaddingRoutes.has(String(route.name || '')));

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDateKeyFromToday(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return toDateInputValue(date);
}

function isDateInRecent7Days(value: string | null): boolean {
  if (!value) return false;
  const today = getDateKeyFromToday(0);
  const day7 = getDateKeyFromToday(6);
  return value >= today && value <= day7;
}

// Get task counts
const getTaskCount = (filter: string) => {
  const tasks = taskStore.tasks.filter(task => task.parentId === null);
  switch (filter) {
    case 'today':
      return tasks.filter(t => t.status === 'todo' && t.dueAt === getDateKeyFromToday(0)).length;
    case 'tomorrow':
      return tasks.filter(t => t.status === 'todo' && t.dueAt === getDateKeyFromToday(1)).length;
    case 'week':
      return tasks.filter(t => t.status === 'todo' && isDateInRecent7Days(t.dueAt)).length;
    case 'all':
      return tasks.filter(t => t.status === 'todo').length;
    case 'completed':
      return tasks.filter(t => t.status === 'done').length;
    default:
      return 0;
  }
};

const getProjectTaskCount = (projectId: number) => {
  return taskStore.tasks.filter(task => task.parentId === null && task.projectId === projectId && task.status === 'todo').length;
};

function openFocusModal() {
  showFocusModal.value = true;
}

function closeFocusModal() {
  showFocusModal.value = false;
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
    confirmDeleteProject(project);
  }
}

function confirmDeleteProject(project: ProjectItem) {
  const taskCount = taskStore.tasks.filter(t => t.projectId === project.id && t.status === 'todo').length;
  const message = taskCount > 0
    ? `确定删除清单「${project.title}」吗？其中 ${taskCount} 个任务将移至收集箱。`
    : `确定删除清单「${project.title}」吗？`;
  if (!window.confirm(message)) return;
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
</script>

<template>
  <div class="flex h-full min-h-screen bg-slate-50">
    <!-- Sidebar -->
    <aside
      class="flex flex-col border-r border-slate-200 bg-white transition-[width] duration-200"
      :class="sidebarCollapsed ? 'w-16' : 'w-60'"
    >
      <!-- App Brand -->
      <div class="flex items-center border-b border-slate-100 px-3 py-3" :class="sidebarCollapsed ? 'justify-center' : 'gap-3 px-4'">
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
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
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

        <!-- Settings - 设置 -->
        <div>
          <RouterLink
            to="/settings"
            class="flex items-center rounded-lg text-sm transition-colors"
            :class="[
              sidebarCollapsed ? 'justify-center px-0 py-2' : 'gap-3 px-3 py-2',
              isActive('/settings')
                ? 'bg-slate-100 text-slate-900'
                : 'text-slate-600 hover:bg-slate-50'
            ]"
            :title="sidebarCollapsed ? '设置' : undefined"
          >
            <svg class="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span v-if="!sidebarCollapsed">设置</span>
          </RouterLink>
        </div>
      </nav>

      <!-- User Profile & Sync -->
      <div class="border-t border-slate-100 p-3" :class="sidebarCollapsed ? 'px-1.5' : ''">
        <div
          class="flex items-center rounded-lg hover:bg-slate-50"
          :class="sidebarCollapsed ? 'justify-center px-0 py-2' : 'gap-3 px-2 py-2'"
        >
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200">
            <svg class="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <template v-if="!sidebarCollapsed">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-slate-700">用户</p>
              <p class="text-xs text-slate-400">未登录</p>
            </div>
            <button class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="同步">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </button>
          </template>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Router View -->
      <main class="flex-1 overflow-auto" :class="mainNeedsBottomPadding ? 'pb-20' : 'pb-0'">
        <RouterView />
      </main>
    </div>

    <!-- Bottom Focus Button -->
    <div class="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center">
      <button
        class="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-800 px-5 py-2.5 text-white shadow-lg transition-colors hover:bg-slate-700"
        @click="openFocusModal"
      >
        <div class="flex h-6 min-w-[3rem] items-center justify-center rounded bg-slate-700 px-2 text-xs font-bold">
          {{ focusButtonTime }}
        </div>
        <span class="max-w-32 truncate text-sm">
          {{ focusButtonLabel }}
        </span>
        <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
    </div>

    <!-- Focus Modal -->
    <FocusModal v-if="showFocusModal" @close="closeFocusModal" />

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
  </div>
</template>
