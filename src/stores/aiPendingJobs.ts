import type { AiAction, AiJob } from '../services/ai/types';

export interface PendingJobPartition {
  visibleJobs: AiJob[];
  supersededJobs: AiJob[];
}

function buildPendingJobKey(job: AiJob): string {
  const taskId = typeof job.inputContext.taskId === 'number' ? job.inputContext.taskId : null;
  return taskId == null ? `job:${job.id}` : `${job.skillId}:${taskId}`;
}

export function partitionPendingJobs(jobs: AiJob[]): PendingJobPartition {
  const seenKeys = new Set<string>();
  const visibleJobs: AiJob[] = [];
  const supersededJobs: AiJob[] = [];

  for (const job of jobs) {
    const key = buildPendingJobKey(job);
    if (seenKeys.has(key)) {
      supersededJobs.push(job);
      continue;
    }

    seenKeys.add(key);
    visibleJobs.push(job);
  }

  return { visibleJobs, supersededJobs };
}

export function rejectPendingActions(actions: AiAction[] | null): AiAction[] | null {
  if (!actions) return null;

  return actions.map((action) => (
    action.status === 'pending'
      ? { ...action, status: 'rejected' }
      : action
  ));
}
