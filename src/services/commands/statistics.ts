import { invokeCommand } from './invoke';

import type {
  DayHourDistributionEntry,
  HeatmapEntry,
  TaskCompletionStats,
  EstimationComparison,
} from '../../types/domain';

export function getTaskCompletionStats(): Promise<TaskCompletionStats> {
  return invokeCommand<TaskCompletionStats>('task_completion_stats');
}

export function getStatsHeatmap(year: number): Promise<HeatmapEntry[]> {
  return invokeCommand<HeatmapEntry[]>('stats_heatmap', { year });
}

export function getStatsDayHourDistribution(days = 14): Promise<DayHourDistributionEntry[]> {
  return invokeCommand<DayHourDistributionEntry[]>('stats_day_hour_distribution', { days });
}

export function getTaskEstimationComparison(options?: {
  fromDate?: string;
  toDate?: string;
  limit?: number;
}): Promise<EstimationComparison[]> {
  return invokeCommand<EstimationComparison[]>('task_estimation_comparison', options);
}
