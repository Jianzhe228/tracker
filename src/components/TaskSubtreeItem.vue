<script setup lang="ts">
import { computed } from 'vue';
import type { TaskItem, Priority } from '../types/domain';

const props = defineProps<{
  task: TaskItem;
  depth: number;
  allTasks: TaskItem[];
  selectedTaskId: number | null;
  expandedTaskIds: Set<number>;
  editingSubtaskId: number | null;
  editingSubtaskTitle: string;
  draggingSubtaskId: number | null;
  isSubtaskDragging: boolean;
  subtaskDragOverId: number | null;
  canDragSort: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', id: number): void;
  (e: 'toggle', id: number): void;
  (e: 'toggle-expand', id: number): void;
  (e: 'start-edit', task: TaskItem): void;
  (e: 'save-edit'): void;
  (e: 'cancel-edit'): void;
  (e: 'edit-keydown', event: KeyboardEvent): void;
  (e: 'focus', id: number, title: string): void;
  (e: 'pointerdown', event: PointerEvent, parentId: number, task: TaskItem): void;
  (e: 'update:editingSubtaskTitle', value: string): void;
}>();

const subtasks = computed(() => {
  return props.allTasks
    .filter(t => t.parentId === props.task.id)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.createdAt.localeCompare(b.createdAt);
    });
});

const hasSubtasks = computed(() => subtasks.value.length > 0);
const isExpanded = computed(() => props.expandedTaskIds.has(props.task.id));
const subtaskDoneCount = computed(() => subtasks.value.filter(t => t.status === 'done').length);

function priorityBarClass(priority: Priority): string {
  switch (priority) {
    case 3: return 'bg-red-400';
    case 2: return 'bg-orange-400';
    case 1: return 'bg-blue-400';
    default: return 'bg-slate-200';
  }
}

function priorityCheckboxClass(priority: Priority): string {
  switch (priority) {
    case 3: return 'border-red-300';
    case 2: return 'border-orange-300';
    case 1: return 'border-blue-300';
    default: return 'border-slate-300';
  }
}

function priorityBadge(priority: Priority): { label: string; cls: string } | null {
  switch (priority) {
    case 3: return { label: 'P0', cls: 'bg-red-50 text-red-600 ring-1 ring-red-200' };
    case 2: return { label: 'P1', cls: 'bg-orange-50 text-orange-600 ring-1 ring-orange-200' };
    case 1: return { label: 'P2', cls: 'bg-blue-50 text-blue-600 ring-1 ring-blue-200' };
    default: return null;
  }
}

function isTaskOverdue(task: TaskItem): boolean {
  if (!task.dueAt || task.status === 'done' || task.status === 'cancelled') return false;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return task.dueAt < todayKey;
}

function formatDueAt(dueAt: string | null): string {
  if (!dueAt) return '';
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  if (dueAt === todayKey) return '今天';
  if (dueAt === tomorrowKey) return '明天';
  const [year, month, day] = dueAt.split('-');
  if (year === String(today.getFullYear())) return `${Number(month)}月${Number(day)}日`;
  return `${year}年${Number(month)}月${Number(day)}日`;
}

const editTitle = computed({
  get: () => props.editingSubtaskTitle,
  set: (val: string) => emit('update:editingSubtaskTitle', val),
});
</script>

<template>
  <div>
    <div
      :data-subtask-id="task.id"
      :data-subtask-parent-id="task.parentId"
      :data-subtask-status="task.status"
      class="group/subtask relative flex cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white transition-all"
      :class="[
        selectedTaskId === task.id ? 'border-blue-300 ring-2 ring-blue-200/80' : '',
        task.status === 'done' ? 'border-green-200' : '',
        isSubtaskDragging ? '' : 'hover:border-slate-300 hover:shadow-sm',
        canDragSort && editingSubtaskId !== task.id
          ? (draggingSubtaskId === task.id && isSubtaskDragging ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing')
          : '',
        draggingSubtaskId === task.id && isSubtaskDragging ? 'task-drag-origin pointer-events-none opacity-35' : '',
        subtaskDragOverId === task.id && draggingSubtaskId !== task.id ? 'border-blue-300 ring-2 ring-blue-100' : ''
      ]"
      @pointerdown="emit('pointerdown', $event, task.parentId!, task)"
      @click="emit('select', task.id)"
    >
      <div class="my-1.5 ml-1 w-1.5 shrink-0 rounded-full transition-colors" :class="priorityBarClass(task.priority)" />

      <div class="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5">
        <button
          role="checkbox"
          :aria-checked="task.status === 'done'"
          :aria-label="task.status === 'done' ? '标记为未完成' : '标记为已完成'"
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          :class="task.status === 'done'
            ? 'border-green-500 bg-green-500'
            : priorityCheckboxClass(task.priority) + ' hover:border-red-400'"
          @click.stop="emit('toggle', task.id)"
        >
          <svg v-if="task.status === 'done'" class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
        </button>

        <div class="min-w-0 flex-1">
          <input
            v-if="editingSubtaskId === task.id"
            v-model="editTitle"
            type="text"
            aria-label="编辑子任务标题"
            class="h-8 w-full rounded border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            @keydown="emit('edit-keydown', $event)"
          >
          <span
            v-else
            class="block truncate text-sm"
            :class="task.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'"
          >
            {{ task.title }}
          </span>
        </div>

        <template v-if="editingSubtaskId !== task.id">
          <!-- Subtask expand button -->
          <button
            v-if="hasSubtasks"
            class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            :class="isExpanded
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-100'"
            :aria-label="isExpanded ? '收起子任务' : '展开子任务'"
            @click.stop="emit('toggle-expand', task.id)"
          >
            <svg
              class="h-3 w-3 transition-transform"
              :class="isExpanded ? 'rotate-90' : ''"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
            <span>{{ subtaskDoneCount }}/{{ subtasks.length }}</span>
          </button>

          <span
            v-if="priorityBadge(task.priority)"
            class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none"
            :class="priorityBadge(task.priority)!.cls"
          >
            {{ priorityBadge(task.priority)!.label }}
          </span>

          <div class="flex items-center gap-1 text-xs text-slate-400">
            <div class="flex items-center gap-0.5">
              <span
                v-for="dotIndex in Math.min(task.pomodoroCount || 1, 5)"
                :key="dotIndex"
                class="h-2 w-2 rounded-full"
                :class="dotIndex <= (task.pomodoroCount || 1)
                  ? (task.status === 'done' ? 'bg-green-400' : 'bg-red-400')
                  : (task.status === 'done' ? 'bg-green-200' : 'bg-red-200')"
              />
            </div>
            <span v-if="(task.pomodoroCount || 1) > 5">+{{ (task.pomodoroCount || 1) - 5 }}</span>
          </div>

          <span class="text-xs" :class="task.status === 'done' ? 'font-medium text-green-600' : isTaskOverdue(task) ? 'font-medium text-red-600' : task.dueAt ? 'text-rose-500' : 'text-slate-400'">
            {{ formatDueAt(task.dueAt) }}
            <span v-if="task.status === 'done'" class="ml-0.5 rounded bg-green-50 px-1 py-0.5 text-[10px] text-green-600 ring-1 ring-green-200">已完成</span>
            <span v-else-if="isTaskOverdue(task)" class="ml-0.5 rounded bg-red-50 px-1 py-0.5 text-[10px] text-red-600 ring-1 ring-red-200">已逾期</span>
          </span>

          <button
            class="rounded p-1 text-slate-400 opacity-0 transition-opacity group-hover/subtask:opacity-100 hover:bg-slate-100 hover:text-slate-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            aria-label="设为当前专注任务"
            @click.stop="emit('focus', task.id, task.title)"
          >
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>

          <button
            class="rounded px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            @click.stop="emit('start-edit', task)"
          >
            编辑
          </button>
        </template>

        <template v-else>
          <button
            class="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            @click.stop="emit('save-edit')"
          >
            保存
          </button>
          <button
            class="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            @click.stop="emit('cancel-edit')"
          >
            取消
          </button>
        </template>
      </div>
    </div>

    <!-- Recursive children -->
    <div
      v-if="isExpanded && hasSubtasks"
      class="task-subtree ml-4 mt-1 space-y-2 border-l border-slate-200/80 pl-3"
    >
      <TaskSubtreeItem
        v-for="child in subtasks"
        :key="child.id"
        :task="child"
        :depth="depth + 1"
        :all-tasks="allTasks"
        :selected-task-id="selectedTaskId"
        :expanded-task-ids="expandedTaskIds"
        :editing-subtask-id="editingSubtaskId"
        v-model:editing-subtask-title="editTitle"
        :dragging-subtask-id="draggingSubtaskId"
        :is-subtask-dragging="isSubtaskDragging"
        :subtask-drag-over-id="subtaskDragOverId"
        :can-drag-sort="canDragSort"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
        @toggle-expand="emit('toggle-expand', $event)"
        @start-edit="emit('start-edit', $event)"
        @save-edit="emit('save-edit')"
        @cancel-edit="emit('cancel-edit')"
        @edit-keydown="emit('edit-keydown', $event)"
        @focus="(id: number, title: string) => emit('focus', id, title)"
        @pointerdown="(ev: PointerEvent, pid: number, t: TaskItem) => emit('pointerdown', ev, pid, t)"
      />
    </div>
  </div>
</template>
