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
} from '../types/domain';
import {
  getStatsDayHourDistribution,
  getStatsHeatmap,
  getTaskCompletionStats,
  getTaskEstimationComparison,
} from '../services/commands/statistics';
import { getFocusSessionStats, getProjectDistribution, listFocusSessions } from '../services/commands/focusSession';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type DateRangePreset = '7d' | '14d' | '30d';

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayDateStr(): string {
  return formatDate(new Date());
}

export const useStatisticsStore = defineStore('statistics', () => {
  const loading = ref(false);
  const dateRange = ref<DateRangePreset>('14d');
  const dayHourWindowDays = ref(14);

  const focusStats = ref<FocusSessionStats | null>(null);
  const projectDistribution = shallowRef<ProjectTimeStat[]>([]);
  const heatmapEntries = shallowRef<HeatmapEntry[]>([]);
  const dayHourDistribution = shallowRef<DayHourDistributionEntry[]>([]);
  const taskCompletion = ref<TaskCompletionStats | null>(null);
  const estVsActual = shallowRef<EstimationComparison[]>([]);
  const todaySessions = shallowRef<FocusSession[]>([]);
  let latestHeatmapRequestId = 0;
  let latestFocusStatsRequestId = 0;
  let latestDayHourRequestId = 0;

  const effectiveDateRange = computed(() => {
    const end = new Date();
    const start = new Date();
    const days = dateRange.value === '7d' ? 6 : dateRange.value === '14d' ? 13 : 29;
    start.setDate(start.getDate() - days);
    return {
      start: formatDate(start),
      end: formatDate(end),
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
    const today = todayDateStr();
    try {
      todaySessions.value = await listFocusSessions({ fromDate: today, limit: 100 });
    } catch (err) {
      console.warn('[statistics] failed to fetch today sessions', err);
    }
  }

  async function fetchAll(): Promise<void> {
    loading.value = true;
    try {
      await Promise.all([
        fetchFocusStats(),
        fetchDayHourDistribution(),
        fetchTaskCompletion(),
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
    focusStats,
    projectDistribution,
    heatmapEntries,
    dayHourDistribution,
    taskCompletion,
    estVsActual,
    todaySessions,
    effectiveDateRange,
    totalFocusMinutes,
    totalPomodoros,
    fetchFocusStats,
    fetchProjectDistribution,
    fetchHeatmap,
    fetchDayHourDistribution,
    fetchTaskCompletion,
    fetchEstVsActual,
    fetchTodaySessions,
    fetchAll,
    setDateRange,
  };
});
