import { invokeCommand } from './invoke';

import type {
  DayHourDistributionEntry,
  HeatmapEntry,
  TaskCompletionStats,
  EstimationComparison,
  StatsOverview,
  WeeklyFocusStat,
  WeeklyTaskVelocity,
} from '../../types/domain';

export function getStatsOverview(): Promise<StatsOverview> {
  return invokeCommand<StatsOverview>('stats_overview');
}

export function getTaskCompletionStats(): Promise<TaskCompletionStats> {
  return invokeCommand<TaskCompletionStats>('task_completion_stats');
}

export function getStatsHeatmap(year: number): Promise<HeatmapEntry[]> {
  return invokeCommand<HeatmapEntry[]>('stats_heatmap', { year });
}

export function getStatsDayHourDistribution(
  days = 14,
  endDate?: string,
): Promise<DayHourDistributionEntry[]> {
  return invokeCommand<DayHourDistributionEntry[]>('stats_day_hour_distribution', { days, endDate });
}

export function getTaskEstimationComparison(options?: {
  fromDate?: string;
  toDate?: string;
  limit?: number;
}): Promise<EstimationComparison[]> {
  return invokeCommand<EstimationComparison[]>('task_estimation_comparison', options);
}

export function getWeeklyFocus(): Promise<WeeklyFocusStat[]> {
  return invokeCommand<WeeklyFocusStat[]>('stats_weekly_focus', {});
}

export function getWeeklyTaskVelocity(): Promise<WeeklyTaskVelocity[]> {
  return invokeCommand<WeeklyTaskVelocity[]>('stats_weekly_task_velocity', {});
}

/** Returns distinct years (DESC) appearing in tasks.created_at / updated_at. */
export function getTaskYearRange(): Promise<number[]> {
  return invokeCommand<number[]>('task_year_range');
}
