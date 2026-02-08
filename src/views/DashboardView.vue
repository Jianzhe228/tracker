<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { useTaskStore } from '../stores/taskStore';
import { useTimerStore } from '../stores/timerStore';
import { useHabitStore } from '../stores/habitStore';

const taskStore = useTaskStore();
const timerStore = useTimerStore();
const habitStore = useHabitStore();

// Stats
const completedToday = computed(() => taskStore.tasks.filter(t => t.status === 'done').length);
const habitCompletedToday = computed(() => habitStore.habits.filter(h => h.checkedToday).length);
const habitTotal = computed(() => habitStore.habits.length);

// Tabs
type TabType = 'overview' | 'focus' | 'tasks' | 'habits';
const activeTab = ref<TabType>('overview');
const dateRange = ref('14d');

const tabs: { key: TabType; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'focus', label: '专注分析' },
  { key: 'tasks', label: '任务分析' },
  { key: 'habits', label: '习惯洞察' }
];

const tabOrder: TabType[] = tabs.map(tab => tab.key);
const wheelSwipeThreshold = 120;
const touchSwipeThreshold = 80;

let wheelAccumX = 0;
let wheelResetTimer: ReturnType<typeof setTimeout> | null = null;
let lastTabSwitchAt = 0;

let touchTracking = false;
let touchStartX = 0;
let touchStartY = 0;
let touchDeltaX = 0;
let touchDeltaY = 0;

function isGestureIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(
    target.closest(
      '[data-gesture-ignore="true"], input, textarea, select, option, button, [contenteditable="true"]'
    )
  );
}

function switchTabByDirection(direction: 1 | -1): void {
  const currentIndex = tabOrder.indexOf(activeTab.value);
  if (currentIndex === -1) return;

  const nextIndex = Math.min(tabOrder.length - 1, Math.max(0, currentIndex + direction));
  if (nextIndex === currentIndex) return;

  activeTab.value = tabOrder[nextIndex];
}

function resetWheelAccumulator(): void {
  wheelAccumX = 0;
  if (wheelResetTimer) {
    clearTimeout(wheelResetTimer);
    wheelResetTimer = null;
  }
}

function handleWheelSwipe(event: WheelEvent): void {
  if (isGestureIgnoredTarget(event.target)) return;
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;

  wheelAccumX += event.deltaX;
  if (wheelResetTimer) clearTimeout(wheelResetTimer);
  wheelResetTimer = setTimeout(() => {
    resetWheelAccumulator();
  }, 180);

  if (Math.abs(wheelAccumX) < wheelSwipeThreshold) return;

  const now = Date.now();
  if (now - lastTabSwitchAt < 220) return;

  event.preventDefault();
  switchTabByDirection(wheelAccumX > 0 ? 1 : -1);
  lastTabSwitchAt = now;
  resetWheelAccumulator();
}

function getAverageTouchPoint(touches: TouchList): { x: number; y: number } {
  if (touches.length >= 2) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2
    };
  }

  return {
    x: touches[0]?.clientX || 0,
    y: touches[0]?.clientY || 0
  };
}

function handleTouchStart(event: TouchEvent): void {
  if (isGestureIgnoredTarget(event.target)) {
    touchTracking = false;
    return;
  }

  if (event.touches.length < 2) {
    touchTracking = false;
    return;
  }

  const point = getAverageTouchPoint(event.touches);
  touchTracking = true;
  touchStartX = point.x;
  touchStartY = point.y;
  touchDeltaX = 0;
  touchDeltaY = 0;
}

function handleTouchMove(event: TouchEvent): void {
  if (!touchTracking || event.touches.length < 2) return;
  const point = getAverageTouchPoint(event.touches);
  touchDeltaX = point.x - touchStartX;
  touchDeltaY = point.y - touchStartY;
}

function handleTouchEnd(): void {
  if (!touchTracking) return;

  const absX = Math.abs(touchDeltaX);
  const absY = Math.abs(touchDeltaY);
  if (absX >= touchSwipeThreshold && absX > absY) {
    switchTabByDirection(touchDeltaX < 0 ? 1 : -1);
  }

  touchTracking = false;
  touchDeltaX = 0;
  touchDeltaY = 0;
}

onUnmounted(() => {
  resetWheelAccumulator();
});

type HeatmapCell = {
  key: string;
  count: number;
  level: number;
  dateLabel: string;
  inYear: boolean;
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
  0: '#e2e8f0',
  1: '#bbf7d0',
  2: '#86efac',
  3: '#4ade80',
  4: '#15803d'
};

const weekdayLabels = ['一', '三', '五'];
const displayYear = new Date().getFullYear();
const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

// Cache all heatmap derivations in one computed to avoid repeated heavy loops.
const heatmapData = computed<HeatmapData>(() => {
  const contributionByDate = new Map<string, number>();

  for (const task of taskStore.tasks) {
    const createdDate = new Date(task.createdAt || task.id);
    if (createdDate.getFullYear() === displayYear) {
      const createdKey = toDateKey(createdDate);
      contributionByDate.set(createdKey, (contributionByDate.get(createdKey) || 0) + 1);
    }

    if (task.status === 'done') {
      const updatedDate = new Date(task.updatedAt || task.createdAt || task.id);
      if (updatedDate.getFullYear() === displayYear) {
        const updatedKey = toDateKey(updatedDate);
        contributionByDate.set(updatedKey, (contributionByDate.get(updatedKey) || 0) + 2);
      }
    }
  }

  const today = new Date();
  if (today.getFullYear() === displayYear) {
    const todayKey = toDateKey(today);
    const todayScore = (contributionByDate.get(todayKey) || 0) + timerStore.completedPomodoros + habitCompletedToday.value;
    contributionByDate.set(todayKey, todayScore);
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
      dateLabel: date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }),
      inYear
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
</script>

<template>
  <div
    class="h-full overflow-y-auto p-6"
    @wheel="handleWheelSwipe"
    @touchstart="handleTouchStart"
    @touchmove="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="handleTouchEnd"
  >
    <!-- Page Header -->
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-slate-800">仪表盘</h1>
        <p class="mt-1 text-sm text-slate-500">数据统计与分析</p>
      </div>
      <div class="flex items-center gap-3">
        <select
          v-model="dateRange"
          class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="7d">近 7 天</option>
          <option value="14d">近 14 天</option>
          <option value="30d">近 30 天</option>
        </select>
      </div>
    </div>

    <!-- KPI Cards -->
    <div class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
            <svg class="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p class="text-sm text-slate-500">总专注时长</p>
            <p class="text-2xl font-semibold text-slate-800">0 <span class="text-sm font-normal">分钟</span></p>
          </div>
        </div>
      </article>

      <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
            <svg class="h-5 w-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p class="text-sm text-slate-500">完成番茄</p>
            <p class="text-2xl font-semibold text-slate-800">{{ timerStore.completedPomodoros }} <span class="text-sm font-normal">个</span></p>
          </div>
        </div>
      </article>

      <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
            <svg class="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <div>
            <p class="text-sm text-slate-500">完成任务</p>
            <p class="text-2xl font-semibold text-slate-800">{{ completedToday }} <span class="text-sm font-normal">个</span></p>
          </div>
        </div>
      </article>

      <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
            <svg class="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>
          <div>
            <p class="text-sm text-slate-500">习惯完成率</p>
            <p class="text-2xl font-semibold text-slate-800">
              <template v-if="habitTotal > 0">{{ Math.round(habitCompletedToday / habitTotal * 100) }}%</template>
              <template v-else>0%</template>
            </p>
          </div>
        </div>
      </article>
    </div>

    <!-- Tabs -->
    <div class="mb-6 border-b border-slate-200">
      <nav class="-mb-px flex gap-6">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="border-b-2 pb-3 text-sm font-medium transition-colors"
          :class="activeTab === tab.key
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>
    </div>

    <!-- Tab Content -->
    <div class="space-y-6">
      <!-- Overview Tab -->
      <template v-if="activeTab === 'overview'">
        <div class="grid gap-6 lg:grid-cols-2">
          <div class="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
            <div class="mb-4">
              <div>
                <h3 class="font-semibold text-slate-800">年度活跃概览</h3>
                <p class="mt-1 text-xs text-slate-500">{{ heatmapData.activeDays }} 天活跃（{{ displayYear }} 年）</p>
              </div>
            </div>

            <div class="overflow-x-auto rounded-lg bg-slate-50/70 px-4 py-4" data-gesture-ignore="true">
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
                  <div class="mt-0.5 grid w-6 grid-rows-7 items-center gap-1 text-[10px] text-slate-400">
                    <span />
                    <span>{{ weekdayLabels[0] }}</span>
                    <span />
                    <span>{{ weekdayLabels[1] }}</span>
                    <span />
                    <span>{{ weekdayLabels[2] }}</span>
                    <span />
                  </div>

                  <div
                    class="grid flex-1 gap-1"
                    :style="{
                      gridTemplateColumns: `repeat(${heatmapData.weekCount}, minmax(0, 1fr))`,
                      gridTemplateRows: 'repeat(7, minmax(0, 1fr))',
                      gridAutoFlow: 'column'
                    }"
                  >
                    <span
                      v-for="cell in heatmapData.cells"
                      :key="cell.key"
                      class="aspect-square w-full rounded-[2px] border border-white/40"
                      :style="{
                        backgroundColor: heatmapColorMap[cell.level],
                        opacity: cell.inYear ? 1 : 0.35
                      }"
                      :title="`${cell.dateLabel}：${cell.count > 0 ? '活跃' : '未活跃'}`"
                    />
                  </div>
                </div>

                <div class="mt-3 flex items-center justify-end gap-1 text-xs text-slate-400">
                  <span>少</span>
                  <span class="h-3 w-3 rounded-[2px]" :style="{ backgroundColor: heatmapColorMap[0] }" />
                  <span class="h-3 w-3 rounded-[2px]" :style="{ backgroundColor: heatmapColorMap[1] }" />
                  <span class="h-3 w-3 rounded-[2px]" :style="{ backgroundColor: heatmapColorMap[2] }" />
                  <span class="h-3 w-3 rounded-[2px]" :style="{ backgroundColor: heatmapColorMap[3] }" />
                  <span class="h-3 w-3 rounded-[2px]" :style="{ backgroundColor: heatmapColorMap[4] }" />
                  <span>多</span>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-semibold text-slate-800">专注趋势</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无专注数据</p>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-semibold text-slate-800">任务完成趋势</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无任务数据</p>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
            <h3 class="mb-4 font-semibold text-slate-800">时段效率摘要</h3>
            <div class="flex h-32 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无数据</p>
            </div>
          </div>
        </div>
      </template>

      <!-- Focus Tab -->
      <template v-else-if="activeTab === 'focus'">
        <div class="grid gap-6 lg:grid-cols-2">
          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
            <h3 class="mb-4 font-semibold text-slate-800">时段效率分布</h3>
            <div class="flex h-64 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无专注记录</p>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-semibold text-slate-800">每周趋势</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无数据</p>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-semibold text-slate-800">番茄时间轴</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无数据</p>
            </div>
          </div>
        </div>
      </template>

      <!-- Tasks Tab -->
      <template v-else-if="activeTab === 'tasks'">
        <div class="grid gap-6 lg:grid-cols-2">
          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-semibold text-slate-800">任务完成率</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无任务数据</p>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-semibold text-slate-800">预估 vs 实际</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无数据</p>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
            <h3 class="mb-4 font-semibold text-slate-800">标签/清单分布</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无数据</p>
            </div>
          </div>
        </div>
      </template>

      <!-- Habits Tab -->
      <template v-else-if="activeTab === 'habits'">
        <div class="grid gap-6 lg:grid-cols-3">
          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
            <h3 class="mb-4 font-semibold text-slate-800">习惯打卡热力图</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无打卡记录</p>
            </div>
          </div>

          <div class="space-y-4">
            <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p class="text-sm text-slate-500">当前连续</p>
              <p class="text-2xl font-semibold text-slate-800">0 天</p>
            </div>
            <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p class="text-sm text-slate-500">最佳连续</p>
              <p class="text-2xl font-semibold text-slate-800">0 天</p>
            </div>
            <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p class="text-sm text-slate-500">习惯强度</p>
              <p class="text-2xl font-semibold text-slate-800">0%</p>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-3">
            <h3 class="mb-4 font-semibold text-slate-800">周达成趋势</h3>
            <div class="flex h-48 items-center justify-center rounded-lg bg-slate-50">
              <p class="text-sm text-slate-400">暂无数据</p>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
