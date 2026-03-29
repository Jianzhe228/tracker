import type { EstimationComparison } from '../../types/domain';

export const DEFAULT_VISIBLE_ROWS = 8;
export const ACCURATE_MINUTES_THRESHOLD = 3;
export const ACCURATE_PERCENT_THRESHOLD = 10;

export type EstimationAccuracyTone = 'over' | 'under' | 'balanced';

export interface EstimationAccuracyRow extends EstimationComparison {
  estimatedMinutes: number;
  actualMinutes: number;
  deltaMinutes: number;
  absoluteDeltaMinutes: number;
  deltaLabel: string;
  tone: EstimationAccuracyTone;
  completedLabel: string;
  estimatedWidthPercent: number;
  actualPositionPercent: number;
}

export interface EstimationAccuracySummary {
  averageDeltaMinutes: number;
  averageDeviationPercentage: number;
  accurateCount: number;
  totalCount: number;
  largestDeltaTaskTitle: string;
  largestDeltaLabel: string;
  largestDeltaTone: EstimationAccuracyTone;
  scaleMaxMinutes: number;
}

export interface EstimationAccuracyModel {
  rows: EstimationAccuracyRow[];
  hiddenCount: number;
  summary: EstimationAccuracySummary;
}

interface BuildOptions {
  limit?: number;
}

function toRoundedMinutes(seconds: number): number {
  return Math.max(0, Math.round(seconds / 60));
}

function toSingleDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function formatCompletedLabel(value: string): string {
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${Number(match[2])}/${Number(match[3])}`;
}

function classifyTone(deltaMinutes: number, deviationPercentage: number): EstimationAccuracyTone {
  if (
    Math.abs(deltaMinutes) <= ACCURATE_MINUTES_THRESHOLD
    || Math.abs(deviationPercentage) <= ACCURATE_PERCENT_THRESHOLD
  ) {
    return 'balanced';
  }

  return deltaMinutes > 0 ? 'over' : 'under';
}

export function formatDeltaMinutes(deltaMinutes: number): string {
  if (deltaMinutes === 0) return '±0m';
  return `${deltaMinutes > 0 ? '+' : '-'}${Math.abs(deltaMinutes)}m`;
}

export function buildEstimationAccuracyModel(
  data: EstimationComparison[],
  options: BuildOptions = {},
): EstimationAccuracyModel {
  const limit = options.limit ?? DEFAULT_VISIBLE_ROWS;

  const ranked = data
    .map((item) => {
      const estimatedMinutes = toRoundedMinutes(item.estimatedSeconds);
      const actualMinutes = toRoundedMinutes(item.actualSeconds);
      const deltaMinutes = actualMinutes - estimatedMinutes;
      const absoluteDeltaMinutes = Math.abs(deltaMinutes);
      const tone = classifyTone(deltaMinutes, item.deviationPercentage);

      return {
        ...item,
        estimatedMinutes,
        actualMinutes,
        deltaMinutes,
        absoluteDeltaMinutes,
        deltaLabel: formatDeltaMinutes(deltaMinutes),
        tone,
        completedLabel: formatCompletedLabel(item.completedAt),
      };
    })
    .sort((left, right) =>
      right.absoluteDeltaMinutes - left.absoluteDeltaMinutes
      || Math.abs(right.deviationPercentage) - Math.abs(left.deviationPercentage)
      || right.actualMinutes - left.actualMinutes
      || right.estimatedMinutes - left.estimatedMinutes
      || left.taskTitle.localeCompare(right.taskTitle, 'zh-Hans-CN')
    );

  const visibleRows = ranked.slice(0, limit);
  const scaleMaxMinutes = Math.max(
    1,
    ...visibleRows.map(row => Math.max(row.estimatedMinutes, row.actualMinutes)),
  );

  const rows: EstimationAccuracyRow[] = visibleRows.map(row => ({
    ...row,
    estimatedWidthPercent: toSingleDecimal((row.estimatedMinutes / scaleMaxMinutes) * 100),
    actualPositionPercent: toSingleDecimal((row.actualMinutes / scaleMaxMinutes) * 100),
  }));

  const averageDeltaMinutes = rows.length
    ? toSingleDecimal(rows.reduce((sum, row) => sum + row.absoluteDeltaMinutes, 0) / rows.length)
    : 0;
  const averageDeviationPercentage = rows.length
    ? toSingleDecimal(rows.reduce((sum, row) => sum + Math.abs(row.deviationPercentage), 0) / rows.length)
    : 0;
  const accurateCount = rows.filter(row => row.tone === 'balanced').length;
  const largestDeltaRow = rows[0];

  return {
    rows,
    hiddenCount: Math.max(0, ranked.length - rows.length),
    summary: {
      averageDeltaMinutes,
      averageDeviationPercentage,
      accurateCount,
      totalCount: rows.length,
      largestDeltaTaskTitle: largestDeltaRow?.taskTitle ?? '',
      largestDeltaLabel: largestDeltaRow?.deltaLabel ?? '±0m',
      largestDeltaTone: largestDeltaRow?.tone ?? 'balanced',
      scaleMaxMinutes,
    },
  };
}
