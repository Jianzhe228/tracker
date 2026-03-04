<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useTaskStore } from '../stores/taskStore';
import { useTimerStore } from '../stores/timerStore';
import { useStatisticsStore } from '../stores/statisticsStore';
import DayHourDistributionChart from '../components/charts/DayHourDistributionChart.vue';
import TaskCompletionChart from '../components/charts/TaskCompletionChart.vue';
import type { HeatmapEntry, TaskItem } from '../types/domain';

const router = useRouter();
const taskStore = useTaskStore();
const timerStore = useTimerStore();
const statisticsStore = useStatisticsStore();

onMounted(() => {
  void statisticsStore.fetchAll();
});

onMounted(() => {
  void nextTick(() => {
    if (!dayHourSectionRef.value || typeof IntersectionObserver === 'undefined') {
      shouldRenderDayHourChart.value = true;
      return;
    }

    dayHourObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        shouldRenderDayHourChart.value = true;
        if (dayHourObserver) {
          dayHourObserver.disconnect();
          dayHourObserver = null;
        }
        break;
      }
    }, {
      root: null,
      rootMargin: '120px 0px',
      threshold: 0.05,
    });

    dayHourObserver.observe(dayHourSectionRef.value);
  });
});

onUnmounted(() => {
  if (dayHourObserver) {
    dayHourObserver.disconnect();
    dayHourObserver = null;
  }
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (heatmapResizeObserver) {
    heatmapResizeObserver.disconnect();
    heatmapResizeObserver = null;
  }
});

const todayFocusMinutes = computed(() => statisticsStore.totalFocusMinutes);
const todayPomodoros = computed(() =>
  statisticsStore.totalPomodoros + timerStore.completedPomodoros
);
const todayTasksDone = computed(() =>
  taskStore.tasks.filter(t => t.status === 'done').length
);

type HeatmapCell = {
  key: string;
  count: number;
  level: number;
  dateLabel: string;
  inYear: boolean;
  focusSeconds: number;
  taskCount: number;
  pomodoroCount: number;
};

type MonthLabel = {
  key: string;
  weekIndex: number;
  label: string;
  leftPercent: number;
};

type HeatmapData = {
  cells: HeatmapCell[];
  monthLabels: MonthLabel[];
  activeDays: number;
  weekCount: number;
};

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function levelByCount(count: number): number {
  if (count <= 0) return 0;
  if (count <= 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

const heatmapColorMap: Record<number, string> = {
  0: '#f1f5f9',
  1: '#dbeafe',
  2: '#93c5fd',
  3: '#60a5fa',
  4: '#2563eb'
};

const heatmapColorMapDimmed: Record<number, string> = {
  0: '#f8fafc',
  1: '#f8fafc',
  2: '#f8fafc',
  3: '#f8fafc',
  4: '#f8fafc'
};

const weekdayLabels = ['一', '三', '五'];
const currentYear = new Date().getFullYear();
const selectedYear = ref<number>(currentYear);
const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const hoveredCellKey = ref<string | null>(null);
const dayHourSectionRef = ref<HTMLElement | null>(null);
const shouldRenderDayHourChart = ref(false);
let dayHourObserver: IntersectionObserver | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const todayKey = computed(() => toDateKey(new Date()));

// Throttled refresh: coalesce multiple triggers within a window
function scheduleStatsRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void Promise.all([
      statisticsStore.fetchFocusStats(),
      statisticsStore.fetchDayHourDistribution(),
      statisticsStore.fetchHeatmap(selectedYear.value),
    ]);
  }, 2000);
}

watch(
  selectedYear,
  year => {
    hoveredCellKey.value = null;
    void statisticsStore.fetchHeatmap(year);
  },
  { immediate: true }
);

watch(
  () => timerStore.lastFocusSessionSavedAt,
  savedAt => {
    if (!savedAt) return;
    scheduleStatsRefresh();
  }
);

watch(
  () => timerStore.focusSecondsToday,
  (next, prev) => {
    if (next <= prev) return;
    scheduleStatsRefresh();
  }
);

function getDateYear(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear();
}

const availableYears = computed<number[]>(() => {
  const years = new Set<number>([currentYear]);

  for (const task of taskStore.tasks) {
    const createdYear = getDateYear(task.createdAt);
    if (createdYear !== null) years.add(createdYear);

    const updatedYear = getDateYear(task.updatedAt);
    if (updatedYear !== null) years.add(updatedYear);
  }

  return Array.from(years).sort((a, b) => b - a);
});

const heatmapData = computed<HeatmapData>(() => {
  const displayYear = selectedYear.value;
  const contributionByDate = new Map<string, number>();
  const entryByDate = new Map<string, HeatmapEntry>();

  for (const entry of statisticsStore.heatmapEntries) {
    const dateObj = new Date(entry.date);
    if (dateObj.getFullYear() !== displayYear) continue;
    entryByDate.set(entry.date, entry);

    const focusScore = Math.ceil(entry.focusSeconds / 1500);
    const taskScore = entry.taskCount * 2;
    const pomodoroScore = entry.pomodoroCount;
    const totalScore = focusScore + taskScore + pomodoroScore;
    contributionByDate.set(entry.date, totalScore);
  }

  const yearStart = new Date(displayYear, 0, 1);
  const yearEnd = new Date(displayYear, 11, 31);
  const normalizedStart = new Date(yearStart);
  normalizedStart.setDate(normalizedStart.getDate() - normalizedStart.getDay());
  const normalizedEnd = new Date(yearEnd);
  normalizedEnd.setDate(normalizedEnd.getDate() + (6 - normalizedEnd.getDay()));

  const cells: HeatmapCell[] = [];
  const monthLabelMap = new Map<number, number>();
  const current = new Date(normalizedStart);
  let activeDays = 0;
  let index = 0;

  while (current <= normalizedEnd) {
    const date = new Date(current);
    const key = toDateKey(date);
    const inYear = date.getFullYear() === displayYear;
    const count = inYear ? (contributionByDate.get(key) || 0) : 0;
    const dayEntry = inYear ? entryByDate.get(key) : undefined;

    if (inYear && count > 0) {
      activeDays++;
    }

    if (inYear) {
      const month = date.getMonth();
      const weekIndex = Math.floor(index / 7);
      if (!monthLabelMap.has(month)) {
        monthLabelMap.set(month, weekIndex);
      }
    }

    cells.push({
      key,
      count,
      level: levelByCount(count),
      dateLabel: `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`,
      inYear,
      focusSeconds: dayEntry?.focusSeconds || 0,
      taskCount: dayEntry?.taskCount || 0,
      pomodoroCount: dayEntry?.pomodoroCount || 0
    });

    current.setDate(current.getDate() + 1);
    index++;
  }

  const weekCount = Math.ceil(cells.length / 7);

  const monthLabels = Array.from(monthLabelMap.entries())
    .sort(([left], [right]) => left - right)
    .map(([month, weekIndex]) => ({
      key: `${displayYear}-${month + 1}`,
      weekIndex,
      label: monthNames[month],
      leftPercent: weekCount > 0 ? (weekIndex / weekCount) * 100 : 0
    }));

  return {
    cells,
    monthLabels,
    activeDays,
    weekCount
  };
});

const cellByKey = computed<Map<string, HeatmapCell>>(() => {
  const map = new Map<string, HeatmapCell>();
  for (const cell of heatmapData.value.cells) {
    if (cell.inYear) map.set(cell.key, cell);
  }
  return map;
});

const fallbackCellKey = computed<string | null>(() => {
  if (cellByKey.value.has(todayKey.value)) return todayKey.value;

  const cells = heatmapData.value.cells;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i].inYear && cells[i].count > 0) return cells[i].key;
  }

  for (const cell of cells) {
    if (cell.inYear) return cell.key;
  }

  return null;
});

const selectedCellKey = computed<string | null>(() => {
  if (hoveredCellKey.value && cellByKey.value.has(hoveredCellKey.value)) {
    return hoveredCellKey.value;
  }
  return fallbackCellKey.value;
});

const selectedHeatmapCell = computed<HeatmapCell | null>(() => {
  const key = selectedCellKey.value;
  return key ? (cellByKey.value.get(key) ?? null) : null;
});

// --- Canvas-based heatmap rendering ---
const heatmapCanvasRef = ref<HTMLCanvasElement | null>(null);
let heatmapResizeObserver: ResizeObserver | null = null;
let heatmapDrawPending = false;
let cachedCellSize = 0;
let cachedGap = 3;

function scheduleHeatmapDraw(): void {
  if (heatmapDrawPending) return;
  heatmapDrawPending = true;
  requestAnimationFrame(() => {
    heatmapDrawPending = false;
    drawHeatmapCanvas();
  });
}

function drawHeatmapCanvas(): void {
  const canvas = heatmapCanvasRef.value;
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const data = heatmapData.value;
  if (data.cells.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const containerWidth = parent.clientWidth;
  const gap = 3;
  const weekCount = data.weekCount;
  const cellSize = (containerWidth - (weekCount - 1) * gap) / weekCount;
  const totalWidth = containerWidth;
  const totalHeight = cellSize * 7 + gap * 6;

  cachedCellSize = cellSize;
  cachedGap = gap;

  const physW = Math.ceil(totalWidth * dpr);
  const physH = Math.ceil(totalHeight * dpr);
  if (canvas.width !== physW || canvas.height !== physH) {
    canvas.width = physW;
    canvas.height = physH;
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${totalHeight}px`;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, totalWidth, totalHeight);

  const selKey = selectedCellKey.value;
  const hasRoundRect = typeof ctx.roundRect === 'function';
  const r = 2;

  for (let i = 0; i < data.cells.length; i++) {
    const cell = data.cells[i];
    const wk = Math.floor(i / 7);
    const dy = i % 7;
    const x = wk * (cellSize + gap);
    const y = dy * (cellSize + gap);

    const color = cell.inYear
      ? heatmapColorMap[cell.level]
      : heatmapColorMapDimmed[cell.level];

    if (!cell.inYear) ctx.globalAlpha = 0.85;

    ctx.fillStyle = color;
    ctx.beginPath();
    if (hasRoundRect) {
      ctx.roundRect(x, y, cellSize, cellSize, r);
    } else {
      ctx.rect(x, y, cellSize, cellSize);
    }
    ctx.fill();

    if (!cell.inYear) ctx.globalAlpha = 1;

    if (cell.inYear && cell.key === selKey) {
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (hasRoundRect) {
        ctx.roundRect(x + 1, y + 1, cellSize - 2, cellSize - 2, r);
      } else {
        ctx.rect(x + 1, y + 1, cellSize - 2, cellSize - 2);
      }
      ctx.stroke();
    }
  }
}

function heatmapHitTest(event: MouseEvent): HeatmapCell | null {
  const canvas = heatmapCanvasRef.value;
  if (!canvas || cachedCellSize <= 0) return null;

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const step = cachedCellSize + cachedGap;
  const wk = Math.floor(x / step);
  const dy = Math.floor(y / step);

  if (x - wk * step > cachedCellSize || y - dy * step > cachedCellSize) return null;

  const data = heatmapData.value;
  if (wk < 0 || wk >= data.weekCount || dy < 0 || dy >= 7) return null;

  const idx = wk * 7 + dy;
  return idx < data.cells.length ? data.cells[idx] : null;
}

function onHeatmapCanvasClick(event: MouseEvent): void {
  const cell = heatmapHitTest(event);
  if (cell?.inYear) {
    hoveredCellKey.value = cell.key;
  }
}

function onHeatmapCanvasMove(event: MouseEvent): void {
  const canvas = event.target as HTMLCanvasElement;
  const cell = heatmapHitTest(event);
  canvas.style.cursor = cell?.inYear ? 'pointer' : 'default';
}

watch([() => heatmapData.value, selectedCellKey], () => {
  scheduleHeatmapDraw();
});

onMounted(() => {
  nextTick(() => {
    scheduleHeatmapDraw();
    const canvas = heatmapCanvasRef.value;
    if (canvas?.parentElement) {
      heatmapResizeObserver = new ResizeObserver(() => {
        scheduleHeatmapDraw();
      });
      heatmapResizeObserver.observe(canvas.parentElement);
    }
  });
});

// --- Today's tasks ---
function getTodayDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const todayTasks = computed<TaskItem[]>(() => {
  const key = getTodayDateKey();
  return taskStore.tasks
    .filter(t => t.parentId === null && t.dueAt === key && t.status !== 'cancelled')
    .sort((a, b) => {
      if (a.status === 'done' && b.status !== 'done') return 1;
      if (a.status !== 'done' && b.status === 'done') return -1;
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.sortOrder - b.sortOrder;
    });
});

const todayPending = computed(() => todayTasks.value.filter(t => t.status !== 'done').length);

function priorityColor(priority: number): string {
  switch (priority) {
    case 3: return 'bg-red-500';
    case 2: return 'bg-orange-400';
    case 1: return 'bg-blue-400';
    default: return 'bg-slate-300';
  }
}

function priorityRingClass(priority: number): string {
  switch (priority) {
    case 3: return 'border-red-400';
    case 2: return 'border-orange-400';
    case 1: return 'border-blue-400';
    default: return 'border-slate-300';
  }
}

async function handleToggleTask(id: number): Promise<void> {
  await taskStore.toggleTask(id);
}

function goToTodayTasks(): void {
  void router.push('/tasks/today');
}
</script>

<template>
  <div class="h-full p-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-slate-800">仪表盘</h1>
      <p class="mt-1 text-sm text-slate-500">数据统计与分析</p>
    </div>

    <div class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
            <svg class="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p class="text-sm text-slate-500">总专注时长</p>
            <p class="text-2xl font-semibold tabular-nums text-slate-800">{{ todayFocusMinutes }} <span class="text-sm font-normal">分钟</span></p>
          </div>
        </div>
      </article>

      <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
            <svg class="h-5 w-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p class="text-sm text-slate-500">完成番茄</p>
            <p class="text-2xl font-semibold tabular-nums text-slate-800">{{ todayPomodoros }} <span class="text-sm font-normal">个</span></p>
          </div>
        </div>
      </article>

      <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
            <svg class="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <div>
            <p class="text-sm text-slate-500">完成任务</p>
            <p class="text-2xl font-semibold tabular-nums text-slate-800">{{ todayTasksDone }} <span class="text-sm font-normal">个</span></p>
          </div>
        </div>
      </article>
    </div>

    <div class="space-y-6">
      <div class="dashboard-panel w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold text-slate-800">年度活跃热力图</h3>
            <p class="mt-1 text-xs text-slate-500">{{ heatmapData.activeDays }} 天活跃（{{ selectedYear }} 年）</p>
          </div>
          <label class="inline-flex items-center gap-2 text-xs text-slate-500">
            <span>年份</span>
            <select
              v-model.number="selectedYear"
              class="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option v-for="year in availableYears" :key="year" :value="year">{{ year }} 年</option>
            </select>
          </label>
        </div>

        <div
          class="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600"
        >
          <span class="font-medium text-slate-700">
            {{ selectedHeatmapCell?.dateLabel || `${selectedYear}年` }}
          </span>
          <span class="rounded-full bg-white px-2 py-0.5 text-slate-600">
            专注 {{ Math.round((selectedHeatmapCell?.focusSeconds || 0) / 60) }} 分钟
          </span>
          <span class="rounded-full bg-white px-2 py-0.5 text-slate-600">
            任务 {{ selectedHeatmapCell?.taskCount || 0 }}
          </span>
          <span class="rounded-full bg-white px-2 py-0.5 text-slate-600">
            番茄 {{ selectedHeatmapCell?.pomodoroCount || 0 }}
          </span>
          <span v-if="selectedHeatmapCell?.count" class="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700">
            活跃强度 {{ selectedHeatmapCell.count }}
          </span>
        </div>

        <div class="overflow-x-auto rounded-lg bg-slate-50/70 px-4 py-4" style="contain: content;">
          <div class="mx-auto min-w-[760px]">
            <div class="flex gap-2">
              <div class="w-6" />
              <div class="relative mb-2 h-4 flex-1">
                <span
                  v-for="label in heatmapData.monthLabels"
                  :key="label.key"
                  class="absolute whitespace-nowrap text-xs text-slate-400"
                  :style="{ left: `${label.leftPercent}%` }"
                >
                  {{ label.label }}
                </span>
              </div>
            </div>

            <div class="flex gap-2">
              <div class="mt-0.5 grid w-6 grid-rows-7 items-center gap-[3px] text-[10px] text-slate-400">
                <span />
                <span>{{ weekdayLabels[0] }}</span>
                <span />
                <span>{{ weekdayLabels[1] }}</span>
                <span />
                <span>{{ weekdayLabels[2] }}</span>
                <span />
              </div>

              <div class="flex-1">
                <canvas
                  ref="heatmapCanvasRef"
                  class="block"
                  @click="onHeatmapCanvasClick"
                  @mousemove="onHeatmapCanvasMove"
                />
              </div>
            </div>

            <div class="mt-3 flex items-center justify-end gap-1 text-xs text-slate-400">
              <span>少</span>
              <span class="h-3 w-3 rounded-sm" :style="{ backgroundColor: heatmapColorMap[0] }" />
              <span class="h-3 w-3 rounded-sm" :style="{ backgroundColor: heatmapColorMap[1] }" />
              <span class="h-3 w-3 rounded-sm" :style="{ backgroundColor: heatmapColorMap[2] }" />
              <span class="h-3 w-3 rounded-sm" :style="{ backgroundColor: heatmapColorMap[3] }" />
              <span class="h-3 w-3 rounded-sm" :style="{ backgroundColor: heatmapColorMap[4] }" />
              <span>多</span>
            </div>
          </div>
        </div>
      </div>

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr),340px]">
        <!-- Day-hour distribution -->
        <div ref="dayHourSectionRef" class="dashboard-panel rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 class="font-semibold text-slate-800">每日时段任务消耗分布</h3>
              <p class="mt-0.5 text-xs text-slate-500">近 {{ statisticsStore.dayHourWindowDays }} 天按小时分布</p>
            </div>
          </div>
          <DayHourDistributionChart
            v-if="shouldRenderDayHourChart"
            :data="statisticsStore.dayHourDistribution"
            :days="statisticsStore.dayHourWindowDays"
          />
          <div v-else class="flex h-[320px] items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-400">
            图表准备中…
          </div>
        </div>

        <!-- Right column: pie chart + today's tasks -->
        <div class="space-y-6">
          <div class="dashboard-panel rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 class="font-semibold text-slate-800">任务完成概览</h3>
            <p class="mt-0.5 text-xs text-slate-500">所有任务按状态分布</p>
            <TaskCompletionChart :data="statisticsStore.taskCompletion" />
            <p v-if="statisticsStore.taskCompletion" class="text-center text-xs text-slate-400">
              共 {{ statisticsStore.taskCompletion.total }} 个任务
            </p>
          </div>

          <!-- Today's Tasks -->
          <div class="dashboard-panel rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="mb-4 flex items-center justify-between">
              <div>
                <h3 class="font-semibold text-slate-800">今日任务</h3>
                <p class="mt-0.5 text-xs text-slate-500">
                  <template v-if="todayTasks.length > 0">
                    {{ todayPending }} 项待办，共 {{ todayTasks.length }} 项
                  </template>
                  <template v-else>暂无今日任务</template>
                </p>
              </div>
              <button
                class="rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50"
                @click="goToTodayTasks"
              >
                查看全部
              </button>
            </div>

            <div v-if="todayTasks.length > 0" class="space-y-1.5">
              <div
                v-for="task in todayTasks"
                :key="task.id"
                class="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-50"
              >
                <!-- Priority bar -->
                <div class="h-5 w-1 shrink-0 rounded-full" :class="priorityColor(task.priority)" />

                <!-- Checkbox -->
                <button
                  role="checkbox"
                  :aria-checked="task.status === 'done'"
                  :aria-label="task.status === 'done' ? '标记为未完成' : '标记为已完成'"
                  class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  :class="task.status === 'done'
                    ? 'border-green-500 bg-green-500'
                    : priorityRingClass(task.priority) + ' hover:border-green-400'"
                  @click.stop="handleToggleTask(task.id)"
                >
                  <svg v-if="task.status === 'done'" class="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                </button>

                <!-- Title -->
                <span
                  class="min-w-0 flex-1 truncate text-sm"
                  :class="task.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'"
                >
                  {{ task.title }}
                </span>

                <!-- Pomodoro dots -->
                <div class="flex shrink-0 items-center gap-0.5">
                  <span
                    v-for="i in Math.min(task.pomodoroCount || 1, 4)"
                    :key="i"
                    class="h-1.5 w-1.5 rounded-full bg-red-400"
                  />
                  <span v-if="(task.pomodoroCount || 1) > 4" class="ml-0.5 text-[10px] text-slate-400">
                    +{{ (task.pomodoroCount || 1) - 4 }}
                  </span>
                </div>
              </div>
            </div>

            <div v-else class="flex flex-col items-center justify-center py-8 text-slate-400">
              <svg class="mb-2 h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p class="text-sm">今天还没有安排任务</p>
              <button
                class="mt-2 text-xs text-blue-500 hover:text-blue-600"
                @click="goToTodayTasks"
              >
                去添加任务
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-panel {
  content-visibility: auto;
  contain-intrinsic-size: 520px;
}
</style>
