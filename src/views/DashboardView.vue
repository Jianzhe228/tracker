<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch, defineAsyncComponent } from 'vue';
import { useTaskStore } from '../stores/taskStore';
import { useTimerStore } from '../stores/timerStore';
import { useStatisticsStore } from '../stores/statisticsStore';
import type {
  DayHourDistributionEntry,
  DailyTotal,
  HeatmapEntry,
  HourlyBucket,
  ProjectTimeStat,
} from '../types/domain';
import {
  getDisplayedTodayFocusSeconds,
  getDisplayedTodayPomodoros,
  type DashboardTimerState,
} from '../utils/dashboardMetrics';
import { toDateKey } from '../utils/date';

// Lazy-load heavy ECharts components — only create instances when needed
const DayHourDistributionChart = defineAsyncComponent(() => import('../components/charts/DayHourDistributionChart.vue'));
const FocusTrendChart = defineAsyncComponent(() => import('../components/charts/FocusTrendChart.vue'));
const HourlyDistributionChart = defineAsyncComponent(() => import('../components/charts/HourlyDistributionChart.vue'));
const ProjectDistributionChart = defineAsyncComponent(() => import('../components/charts/ProjectDistributionChart.vue'));
const EstVsActualChart = defineAsyncComponent(() => import('../components/charts/EstVsActualChart.vue'));
const WeeklyFocusTrendChart = defineAsyncComponent(() => import('../components/charts/WeeklyFocusTrendChart.vue'));
const TaskVelocityChart = defineAsyncComponent(() => import('../components/charts/TaskVelocityChart.vue'));

const taskStore = useTaskStore();
const timerStore = useTimerStore();
const statisticsStore = useStatisticsStore();

onMounted(() => {
  void statisticsStore.fetchAll();
});

// ── Phased rendering: stagger heavy chart initialization ──
// Phase 0 (immediate): metric cards + heatmap canvas
// Phase 1 (after first paint): trend + hourly charts
// Phase 2 (after phase 1): day-hour heatmap
// Phase 3 (after phase 2): project dist + est accuracy + weekly focus + velocity
const renderPhase = ref(0);

onMounted(() => {
  requestAnimationFrame(() => {
    renderPhase.value = 1;
    requestAnimationFrame(() => {
      renderPhase.value = 2;
      requestAnimationFrame(() => {
        renderPhase.value = 3;
      });
    });
  });
});

onUnmounted(() => {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (heatmapResizeObserver) {
    heatmapResizeObserver.disconnect();
    heatmapResizeObserver = null;
  }
});

// --- Overview metric cards ---
const overview = computed(() => statisticsStore.overview);

const dashboardTimerState = computed<DashboardTimerState>(() => ({
  status: timerStore.status,
  mode: timerStore.mode,
  timerKind: timerStore.timerKind,
  totalSeconds: timerStore.totalSeconds,
  remainingSeconds: timerStore.remainingSeconds,
  elapsedSeconds: timerStore.elapsedSeconds,
  currentSegmentSeconds: timerStore.currentSegmentFocusSeconds,
}));

const todayFocusSecondsIncludingCurrentSession = computed(() =>
  getDisplayedTodayFocusSeconds(
    Math.max(overview.value?.today.focusSeconds ?? 0, timerStore.focusSecondsToday),
    dashboardTimerState.value,
  )
);

const todayPomodorosIncludingCurrentSession = computed(() =>
  getDisplayedTodayPomodoros(
    Math.max(overview.value?.today.pomodoros ?? 0, timerStore.completedPomodoros),
    dashboardTimerState.value,
  )
);

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? m + 'm' : ''}`;
  return `${m}`;
}

function formatPomodoros(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

type LiveFocusSegment = {
  taskId: number | null;
  dateKey: string;
  hour: number;
  durationSeconds: number;
  pomodoroCount: number;
};

const activeFocusSegments = computed<LiveFocusSegment[]>(() => {
  if (timerStore.mode !== 'focus' || timerStore.idle || timerStore.segments.length === 0) {
    return [];
  }

  const baselineSeconds = Math.max(60, timerStore.totalSeconds);

  return timerStore.segments
    .map((segment, index) => {
      const durationSeconds = segment.closed
        ? Math.max(0, Math.round(segment.durationMs / 1000))
        : (index === timerStore.segments.length - 1 ? timerStore.currentSegmentFocusSeconds : 0);

      if (durationSeconds <= 0) {
        return null;
      }

      const startedAt = new Date(segment.startedAt);
      return {
        taskId: segment.taskId,
        dateKey: toDateKey(startedAt),
        hour: startedAt.getHours(),
        durationSeconds,
        pomodoroCount: durationSeconds / baselineSeconds,
      };
    })
    .filter((segment): segment is LiveFocusSegment => segment != null);
});

const displayedDailyTotals = computed<DailyTotal[]>(() => {
  const base = new Map<string, DailyTotal>();

  for (const row of statisticsStore.focusStats?.dailyTotals ?? []) {
    base.set(row.date, { ...row });
  }

  for (const segment of activeFocusSegments.value) {
    const current = base.get(segment.dateKey) ?? {
      date: segment.dateKey,
      totalSeconds: 0,
      pomodoroCount: 0,
      sessionCount: 0,
    };
    current.totalSeconds += segment.durationSeconds;
    current.pomodoroCount += segment.pomodoroCount;
    current.sessionCount += 1;
    base.set(segment.dateKey, current);
  }

  return Array.from(base.values()).sort((left, right) => left.date.localeCompare(right.date));
});

const displayedHourlyDistribution = computed<HourlyBucket[]>(() => {
  const base = new Map<number, HourlyBucket>();

  for (const row of statisticsStore.focusStats?.hourlyDistribution ?? []) {
    base.set(row.hour, { ...row });
  }

  for (const segment of activeFocusSegments.value) {
    const current = base.get(segment.hour) ?? {
      hour: segment.hour,
      totalSeconds: 0,
      sessionCount: 0,
    };
    current.totalSeconds += segment.durationSeconds;
    current.sessionCount += 1;
    base.set(segment.hour, current);
  }

  return Array.from({ length: 24 }, (_value, hour) => base.get(hour) ?? {
    hour,
    totalSeconds: 0,
    sessionCount: 0,
  });
});

const displayedDayHourDistribution = computed<DayHourDistributionEntry[]>(() => {
  const base = new Map<string, DayHourDistributionEntry>();

  for (const row of statisticsStore.dayHourDistribution) {
    base.set(`${row.date}-${row.hour}`, { ...row });
  }

  for (const segment of activeFocusSegments.value) {
    const key = `${segment.dateKey}-${segment.hour}`;
    const current = base.get(key) ?? {
      date: segment.dateKey,
      hour: segment.hour,
      totalSeconds: 0,
      sessionCount: 0,
      pomodoroCount: 0,
    };
    current.totalSeconds += segment.durationSeconds;
    current.sessionCount += 1;
    current.pomodoroCount += segment.pomodoroCount;
    base.set(key, current);
  }

  return Array.from(base.values()).sort((left, right) =>
    right.date.localeCompare(left.date) || left.hour - right.hour
  );
});

function getProjectTitle(projectId: number | null): string {
  if (projectId == null) return '未分类';
  return taskStore.projects.find(project => project.id === projectId)?.title ?? '未分类';
}

const displayedProjectDistribution = computed<ProjectTimeStat[]>(() => {
  const base = new Map<string, ProjectTimeStat>();

  for (const row of statisticsStore.projectDistribution) {
    base.set(String(row.projectId ?? 'null'), { ...row });
  }

  for (const segment of activeFocusSegments.value) {
    const projectId = segment.taskId != null
      ? (taskStore.tasks.find(task => task.id === segment.taskId)?.projectId ?? null)
      : null;
    const key = String(projectId ?? 'null');
    const current = base.get(key) ?? {
      projectId,
      projectTitle: getProjectTitle(projectId),
      totalSeconds: 0,
      sessionCount: 0,
    };
    current.totalSeconds += segment.durationSeconds;
    current.sessionCount += 1;
    base.set(key, current);
  }

  return Array.from(base.values()).sort((left, right) => right.totalSeconds - left.totalSeconds);
});

const displayedHeatmapEntries = computed<HeatmapEntry[]>(() => {
  const base = new Map<string, HeatmapEntry>();

  for (const entry of statisticsStore.heatmapEntries) {
    base.set(entry.date, { ...entry });
  }

  for (const segment of activeFocusSegments.value) {
    const current = base.get(segment.dateKey) ?? {
      date: segment.dateKey,
      focusSeconds: 0,
      taskCount: 0,
      pomodoroCount: 0,
    };
    current.focusSeconds += segment.durationSeconds;
    current.pomodoroCount += segment.pomodoroCount;
    base.set(segment.dateKey, current);
  }

  return Array.from(base.values()).sort((left, right) => left.date.localeCompare(right.date));
});

// --- Heatmap ---
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
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const todayKey = computed(() => toDateKey(new Date()));

// Throttled refresh: coalesce multiple triggers within a window
function scheduleStatsRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void Promise.all([
      statisticsStore.fetchOverview(),
      statisticsStore.fetchFocusStats(),
      statisticsStore.fetchDayHourDistribution(),
      statisticsStore.fetchProjectDistribution(),
      statisticsStore.fetchWeeklyFocus(),
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

  for (const entry of displayedHeatmapEntries.value) {
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

// --- Heatmap tooltip ---
const hoveredCell = ref<HeatmapCell | null>(null);
const tooltipPos = ref<{ x: number; y: number }>({ x: 0, y: 0 });

function onHeatmapCanvasMove(event: MouseEvent): void {
  const canvas = event.target as HTMLCanvasElement;
  const cell = heatmapHitTest(event);
  canvas.style.cursor = cell?.inYear ? 'pointer' : 'default';

  if (cell?.inYear) {
    hoveredCell.value = cell;
    const parent = canvas.parentElement;
    if (parent) {
      const parentRect = parent.getBoundingClientRect();
      tooltipPos.value = {
        x: event.clientX - parentRect.left + 12,
        y: event.clientY - parentRect.top - 8,
      };
    }
  } else {
    hoveredCell.value = null;
  }
}

function onHeatmapCanvasLeave(): void {
  hoveredCell.value = null;
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
</script>

<template>
  <div class="h-full overflow-y-auto p-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-slate-800">仪表盘</h1>
      <p class="mt-1 text-sm text-slate-500">数据统计与分析</p>
    </div>

    <!-- ── Metric Cards ─────────────────────────────────────────── -->
    <div class="mb-6 grid gap-4 grid-cols-2 lg:grid-cols-4">
      <article class="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-100">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="text-xs text-slate-500">今日专注</p>
            <p class="text-xl font-bold tabular-nums text-slate-800">
              {{ formatDuration(todayFocusSecondsIncludingCurrentSession) }}
              <span v-if="todayFocusSecondsIncludingCurrentSession < 3600" class="text-xs font-normal text-slate-400">分钟</span>
            </p>
          </div>
        </div>
      </article>

      <article class="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-500 transition-colors group-hover:bg-red-100">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
              <circle cx="12" cy="12" r="4" />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="text-xs text-slate-500">今日番茄</p>
            <p class="text-xl font-bold tabular-nums text-slate-800">
              {{ formatPomodoros(todayPomodorosIncludingCurrentSession) }}
              <span class="text-xs font-normal text-slate-400">个</span>
            </p>
          </div>
        </div>
      </article>

      <article class="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-600 transition-colors group-hover:bg-green-100">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="text-xs text-slate-500">今日完成</p>
            <p class="text-xl font-bold tabular-nums text-slate-800">
              {{ overview?.today.tasksCompleted ?? 0 }}
              <span class="text-xs font-normal text-slate-400">个任务</span>
            </p>
          </div>
        </div>
      </article>

      <article class="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-600 transition-colors group-hover:bg-purple-100">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="text-xs text-slate-500">本周累计</p>
            <p class="text-xl font-bold tabular-nums text-slate-800">
              {{ formatDuration(overview?.week.focusSeconds ?? 0) }}
              <span v-if="!overview?.week.focusSeconds || overview.week.focusSeconds < 3600" class="text-xs font-normal text-slate-400">分钟</span>
            </p>
          </div>
        </div>
      </article>
    </div>

    <div class="space-y-6">
      <!-- ── Annual Heatmap ─────────────────────────────────────── -->
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
          class="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs text-slate-600"
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
            番茄 {{ formatPomodoros(selectedHeatmapCell?.pomodoroCount || 0) }}
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

              <div class="flex-1" style="position: relative;">
                <canvas
                  ref="heatmapCanvasRef"
                  class="block"
                  @click="onHeatmapCanvasClick"
                  @mousemove="onHeatmapCanvasMove"
                  @mouseleave="onHeatmapCanvasLeave"
                />
                <!-- Heatmap hover tooltip -->
                <div
                  v-if="hoveredCell"
                  class="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-slate-800 px-3 py-2 text-xs text-white shadow-lg"
                  :style="{ left: tooltipPos.x + 'px', top: tooltipPos.y + 'px', transform: 'translateY(-100%)' }"
                >
                  <div class="font-medium">{{ hoveredCell.dateLabel }}</div>
                  <div class="mt-1 text-slate-300">
                    专注 {{ Math.round(hoveredCell.focusSeconds / 60) }} 分钟
                    · 任务 {{ hoveredCell.taskCount }}
                    · 番茄 {{ formatPomodoros(hoveredCell.pomodoroCount) }}
                  </div>
                </div>
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

      <!-- ── Focus Trend + Hourly Distribution (Phase 1) ─────── -->
      <div class="grid gap-6 lg:grid-cols-2">
        <div class="dashboard-panel rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 class="font-semibold text-slate-800">近期专注趋势</h3>
          <p class="mt-0.5 mb-2 text-xs text-slate-500">{{ displayedDailyTotals.length }} 天趋势</p>
          <FocusTrendChart
            v-if="renderPhase >= 1 && displayedDailyTotals.length"
            :data="displayedDailyTotals"
            compact
          />
          <div v-else class="flex h-[180px] items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-400">
            {{ renderPhase < 1 ? '加载中…' : '暂无数据' }}
          </div>
        </div>

        <div class="dashboard-panel rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 class="font-semibold text-slate-800">高产时段分布</h3>
          <p class="mt-0.5 mb-2 text-xs text-slate-500">按小时分布</p>
          <HourlyDistributionChart
            v-if="renderPhase >= 1 && displayedHourlyDistribution.length"
            :data="displayedHourlyDistribution"
            compact
          />
          <div v-else class="flex h-[180px] items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-400">
            {{ renderPhase < 1 ? '加载中…' : '暂无数据' }}
          </div>
        </div>
      </div>

      <!-- ── Day-Hour Distribution (Phase 2, full width) ────────── -->
      <div class="dashboard-panel rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold text-slate-800">每日时段消耗分布</h3>
            <p class="mt-0.5 text-xs text-slate-500">{{ statisticsStore.dayHourWindowDays }} 天分布</p>
          </div>
        </div>
        <DayHourDistributionChart
          v-if="renderPhase >= 2"
          :data="displayedDayHourDistribution"
          :days="statisticsStore.dayHourWindowDays"
        />
        <div v-else class="flex h-[320px] items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-400">
          加载中…
        </div>
      </div>

      <!-- ── Project Distribution + Estimation Accuracy (Phase 3) ── -->
      <div class="grid gap-6 lg:grid-cols-2">
        <div class="dashboard-panel rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 class="font-semibold text-slate-800">项目时间分布</h3>
          <p class="mt-0.5 mb-2 text-xs text-slate-500">时间占比</p>
          <ProjectDistributionChart
            v-if="renderPhase >= 3 && displayedProjectDistribution.length"
            :data="displayedProjectDistribution"
          />
          <div v-else class="flex h-[200px] items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-400">
            {{ renderPhase < 3 ? '加载中…' : '暂无数据' }}
          </div>
        </div>

        <div class="dashboard-panel rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 class="font-semibold text-slate-800">估算准确度</h3>
          <p class="mt-0.5 mb-2 text-xs text-slate-500">按偏差排序</p>
          <EstVsActualChart
            v-if="renderPhase >= 3 && statisticsStore.estVsActual.length"
            :data="statisticsStore.estVsActual"
          />
          <div v-else class="flex h-[200px] items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-400">
            {{ renderPhase < 3 ? '加载中…' : '暂无数据' }}
          </div>
        </div>
      </div>

      <!-- ── Weekly Focus Trend + Task Velocity (Phase 3) ────────── -->
      <div class="grid gap-6 lg:grid-cols-2">
        <div class="dashboard-panel rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 class="font-semibold text-slate-800">每周专注趋势</h3>
          <p class="mt-0.5 mb-2 text-xs text-slate-500">12 周趋势</p>
          <WeeklyFocusTrendChart
            v-if="renderPhase >= 3 && statisticsStore.weeklyFocus.length"
            :data="statisticsStore.weeklyFocus"
          />
          <div v-else class="flex h-[200px] items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-400">
            {{ renderPhase < 3 ? '加载中…' : '暂无数据' }}
          </div>
        </div>

        <div class="dashboard-panel rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 class="font-semibold text-slate-800">任务完成速度</h3>
          <p class="mt-0.5 mb-2 text-xs text-slate-500">12 周趋势</p>
          <TaskVelocityChart
            v-if="renderPhase >= 3 && statisticsStore.weeklyTaskVelocity.length"
            :data="statisticsStore.weeklyTaskVelocity"
          />
          <div v-else class="flex h-[200px] items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-400">
            {{ renderPhase < 3 ? '加载中…' : '暂无数据' }}
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
