import { describe, expect, it } from 'vitest';

import type { EstimationComparison } from '../../../types/domain';
import {
  ACCURATE_MINUTES_THRESHOLD,
  buildEstimationAccuracyModel,
  formatDeltaMinutes,
} from '../estVsActualModel';

const sample: EstimationComparison[] = [
  {
    taskId: 1,
    taskTitle: '复习昨天的词汇',
    estimatedSeconds: 30 * 60,
    actualSeconds: 48 * 60,
    deviationPercentage: 60,
    completedAt: '2026-03-28 20:00:00',
  },
  {
    taskId: 2,
    taskTitle: '练习听力',
    estimatedSeconds: 40 * 60,
    actualSeconds: 24 * 60,
    deviationPercentage: 40,
    completedAt: '2026-03-27 19:00:00',
  },
  {
    taskId: 3,
    taskTitle: '写三篇阅读',
    estimatedSeconds: 25 * 60,
    actualSeconds: 27 * 60,
    deviationPercentage: 8,
    completedAt: '2026-03-26 18:00:00',
  },
  {
    taskId: 4,
    taskTitle: '整理错题',
    estimatedSeconds: 20 * 60,
    actualSeconds: 23 * 60,
    deviationPercentage: 15,
    completedAt: '2026-03-25T17:00:00Z',
  },
];

describe('buildEstimationAccuracyModel', () => {
  it('sorts by absolute delta and limits the visible sample', () => {
    const model = buildEstimationAccuracyModel(sample, { limit: 3 });

    expect(model.rows.map(row => row.taskId)).toEqual([1, 2, 4]);
    expect(model.hiddenCount).toBe(1);
    expect(model.summary.totalCount).toBe(3);
    expect(model.summary.scaleMaxMinutes).toBe(48);

    expect(model.rows[0].estimatedWidthPercent).toBeCloseTo(62.5, 1);
    expect(model.rows[1].actualPositionPercent).toBeCloseTo(50, 1);
    expect(model.rows[2].completedLabel).toBe('3/25');
  });

  it('builds summary stats and classifies near-accurate rows', () => {
    const model = buildEstimationAccuracyModel(sample, { limit: 3 });

    expect(ACCURATE_MINUTES_THRESHOLD).toBe(3);
    expect(model.rows[0].tone).toBe('over');
    expect(model.rows[1].tone).toBe('under');
    expect(model.rows[2].tone).toBe('balanced');

    expect(model.summary.accurateCount).toBe(1);
    expect(model.summary.averageDeltaMinutes).toBeCloseTo(12.3, 1);
    expect(model.summary.averageDeviationPercentage).toBeCloseTo(38.3, 1);
    expect(model.summary.largestDeltaTaskTitle).toBe('复习昨天的词汇');
    expect(model.summary.largestDeltaLabel).toBe('+18m');
  });
});

describe('formatDeltaMinutes', () => {
  it('formats positive, negative and zero deltas consistently', () => {
    expect(formatDeltaMinutes(8)).toBe('+8m');
    expect(formatDeltaMinutes(-3)).toBe('-3m');
    expect(formatDeltaMinutes(0)).toBe('±0m');
  });
});
