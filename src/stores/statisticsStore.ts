import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';

import type {
  DayHourDistributionEntry,
  FocusSessionStats,
  FocusSession,
  ProjectTimeStat,
  HeatmapEntry,
  TaskCompletionStats,
  EstimationComparison,
  StatsOverview,
  WeeklyFocusStat,
  WeeklyTaskVelocity,
} from '../types/domain';
import {
  getStatsDayHourDistribution,
  getStatsHeatmap,
  getStatsOverview,
  getTaskCompletionStats,
  getTaskEstimationComparison,
  getWeeklyFocus,
  getWeeklyTaskVelocity,
} from '../services/commands/statistics';
import { getFocusSessionStats, getProjectDistribution, listFocusSessions } from '../services/commands/focusSession';
import { toDateKey } from '../utils/date';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type DateRangePreset = '7d' | '14d' | '30d';

export const useStatisticsStore = defineStore('statistics', () => {
  const loading = ref(false);
  const dateRange = ref<DateRangePreset>('14d');
  const dayHourWindowDays = ref(14);

  const focusStats = ref<FocusSessionStats | null>(null);
  const overview = ref<StatsOverview | null>(null);
  const projectDistribution = shallowRef<ProjectTimeStat[]>([]);
  const heatmapEntries = shallowRef<HeatmapEntry[]>([]);
  const dayHourDistribution = shallowRef<DayHourDistributionEntry[]>([]);
  const taskCompletion = ref<TaskCompletionStats | null>(null);
  const estVsActual = shallowRef<EstimationComparison[]>([]);
  const todaySessions = shallowRef<FocusSession[]>([]);
  const weeklyFocus = ref<WeeklyFocusStat[]>([]);
  const weeklyTaskVelocity = ref<WeeklyTaskVelocity[]>([]);
  let latestHeatmapRequestId = 0;
  let latestFocusStatsRequestId = 0;
  let latestDayHourRequestId = 0;

  const effectiveDateRange = computed(() => {
    const end = new Date();
    const start = new Date();
    const days = dateRange.value === '7d' ? 6 : dateRange.value === '14d' ? 13 : 29;
    start.setDate(start.getDate() - days);
    return {
      start: toDateKey(start),
      end: toDateKey(end),
    };
  });

  const totalFocusMinutes = computed(() => {
    if (!focusStats.value) return 0;
    return Math.round(focusStats.value.totalFocusSeconds / 60);
  });

  const totalPomodoros = computed(() => {
    if (!focusStats.value) return 0;
    return focusStats.value.totalPomodoros;
  });

  async function fetchOverview(): Promise<void> {
    if (!isTauri) return;
    try {
      overview.value = await getStatsOverview();
    } catch (err) {
      console.warn('[statistics] failed to fetch overview', err);
    }
  }

  async function fetchFocusStats(): Promise<void> {
    if (!isTauri) return;
    const { start, end } = effectiveDateRange.value;
    const requestId = ++latestFocusStatsRequestId;
    try {
      const stats = await getFocusSessionStats(start, end);
      if (requestId !== latestFocusStatsRequestId) return;
      focusStats.value = stats;
    } catch (err) {
      if (requestId !== latestFocusStatsRequestId) return;
      console.warn('[statistics] failed to fetch focus stats', err);
    }
  }

  async function fetchProjectDistribution(): Promise<void> {
    if (!isTauri) return;
    const { start, end } = effectiveDateRange.value;
    try {
      projectDistribution.value = await getProjectDistribution(start, end);
    } catch (err) {
      console.warn('[statistics] failed to fetch project distribution', err);
    }
  }

  async function fetchTaskCompletion(): Promise<void> {
    if (!isTauri) return;
    try {
      taskCompletion.value = await getTaskCompletionStats();
    } catch (err) {
      console.warn('[statistics] failed to fetch task completion', err);
    }
  }

  async function fetchHeatmap(year: number): Promise<void> {
    if (!isTauri) return;
    const requestId = ++latestHeatmapRequestId;
    try {
      const entries = await getStatsHeatmap(year);
      if (requestId !== latestHeatmapRequestId) return;
      heatmapEntries.value = entries;
    } catch (err) {
      if (requestId !== latestHeatmapRequestId) return;
      heatmapEntries.value = [];
      console.warn('[statistics] failed to fetch heatmap', err);
    }
  }

  async function fetchDayHourDistribution(days = dayHourWindowDays.value): Promise<void> {
    if (!isTauri) return;
    const requestId = ++latestDayHourRequestId;
    try {
      const distribution = await getStatsDayHourDistribution(days);
      if (requestId !== latestDayHourRequestId) return;
      dayHourDistribution.value = distribution;
    } catch (err) {
      if (requestId !== latestDayHourRequestId) return;
      dayHourDistribution.value = [];
      console.warn('[statistics] failed to fetch day-hour distribution', err);
    }
  }

  async function fetchEstVsActual(): Promise<void> {
    if (!isTauri) return;
    const { start, end } = effectiveDateRange.value;
    try {
      estVsActual.value = await getTaskEstimationComparison({ fromDate: start, toDate: end });
    } catch (err) {
      console.warn('[statistics] failed to fetch est vs actual', err);
    }
  }

  async function fetchTodaySessions(): Promise<void> {
    if (!isTauri) return;
    const today = toDateKey(new Date());
    try {
      todaySessions.value = await listFocusSessions({ fromDate: today, limit: 100 });
    } catch (err) {
      console.warn('[statistics] failed to fetch today sessions', err);
    }
  }

  async function fetchWeeklyFocus(): Promise<void> {
    if (!isTauri) return;
    try {
      weeklyFocus.value = await getWeeklyFocus();
    } catch (e) {
      console.error('[statistics] fetchWeeklyFocus failed', e);
    }
  }

  async function fetchWeeklyTaskVelocity(): Promise<void> {
    if (!isTauri) return;
    try {
      weeklyTaskVelocity.value = await getWeeklyTaskVelocity();
    } catch (e) {
      console.error('[statistics] fetchWeeklyTaskVelocity failed', e);
    }
  }

  async function fetchAll(): Promise<void> {
    loading.value = true;
    try {
      await Promise.all([
        fetchOverview(),
        fetchFocusStats(),
        fetchDayHourDistribution(),
        fetchProjectDistribution(),
        fetchEstVsActual(),
        fetchWeeklyFocus(),
        fetchWeeklyTaskVelocity(),
      ]);
    } finally {
      loading.value = false;
    }
  }

  function setDateRange(range: DateRangePreset): void {
    dateRange.value = range;
    fetchAll().catch(console.error);
  }

  return {
    loading,
    dateRange,
    dayHourWindowDays,
    overview,
    focusStats,
    projectDistribution,
    heatmapEntries,
    dayHourDistribution,
    taskCompletion,
    estVsActual,
    todaySessions,
    weeklyFocus,
    weeklyTaskVelocity,
    effectiveDateRange,
    totalFocusMinutes,
    totalPomodoros,
    fetchOverview,
    fetchFocusStats,
    fetchProjectDistribution,
    fetchHeatmap,
    fetchDayHourDistribution,
    fetchTaskCompletion,
    fetchEstVsActual,
    fetchTodaySessions,
    fetchWeeklyFocus,
    fetchWeeklyTaskVelocity,
    fetchAll,
    setDateRange,
  };
});
