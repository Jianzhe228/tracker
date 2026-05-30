import { describe, expect, it } from 'vitest';

import type { AiJob } from '../../services/ai/types';
import { partitionPendingJobs, shouldShowPendingJob } from '../aiPendingJobs';

function makeJob(id: number, taskId: number | undefined, skillId = 1): AiJob {
  return {
    id,
    skillId,
    status: 'completed',
    inputContext: taskId ? { taskId, taskTitle: `Task ${taskId}` } : {},
    rawResponse: null,
    actions: [{ type: 'create_subtask', params: { title: `Subtask ${id}` }, status: 'pending' }],
    error: null,
    createdAt: `2026-03-29T10:00:${String(id).padStart(2, '0')}Z`,
    completedAt: `2026-03-29T10:01:${String(id).padStart(2, '0')}Z`,
  };
}

describe('partitionPendingJobs', () => {
  it('keeps only the latest pending job for the same task and skill', () => {
    const latest = makeJob(46, 1001, 1);
    const older = makeJob(43, 1001, 1);
    const oldest = makeJob(41, 1001, 1);

    const result = partitionPendingJobs([latest, older, oldest]);

    expect(result.visibleJobs.map((job) => job.id)).toEqual([46]);
    expect(result.supersededJobs.map((job) => job.id)).toEqual([43, 41]);
  });

  it('keeps jobs for different tasks or skills separate', () => {
    const a = makeJob(50, 1001, 1);
    const b = makeJob(49, 1002, 1);
    const c = makeJob(48, 1001, 2);

    const result = partitionPendingJobs([a, b, c]);

    expect(result.visibleJobs.map((job) => job.id)).toEqual([50, 49, 48]);
    expect(result.supersededJobs).toHaveLength(0);
  });
});

describe('shouldShowPendingJob', () => {
  it('hides jobs explicitly scoped to the sidebar', () => {
    const job = makeJob(60, 1001, 1);
    job.inputContext.suppressNotificationCenter = true;

    expect(shouldShowPendingJob(job, 'custom_skill')).toBe(false);
  });

  it('hides task_decompose jobs from the global notification center', () => {
    const job = makeJob(61, 1001, 1);

    expect(shouldShowPendingJob(job, 'task_decompose')).toBe(false);
  });

  it('keeps other pending action jobs visible', () => {
    const job = makeJob(62, 1001, 2);

    expect(shouldShowPendingJob(job, 'custom_skill')).toBe(true);
  });
});
