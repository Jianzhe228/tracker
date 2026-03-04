import { invokeCommand } from './invoke';
import type { AiSkill, AiJob, AiAction } from '../ai/types';

export function listAiSkills(): Promise<AiSkill[]> {
  return invokeCommand<AiSkill[]>('ai_skill_list');
}

export function getAiSkill(id: number): Promise<AiSkill> {
  return invokeCommand<AiSkill>('ai_skill_get', { id });
}

export function createAiSkill(skill: Partial<AiSkill>): Promise<AiSkill> {
  return invokeCommand<AiSkill>('ai_skill_create', { payload: skill });
}

export function updateAiSkill(id: number, payload: Partial<AiSkill>): Promise<void> {
  return invokeCommand<void>('ai_skill_update', { id, payload });
}

export function toggleAiSkill(id: number, enabled: boolean): Promise<void> {
  return invokeCommand<void>('ai_skill_toggle', { id, enabled });
}

export function createAiJob(skillId: number, inputContext: Record<string, unknown>): Promise<AiJob> {
  return invokeCommand<AiJob>('ai_job_create', { skillId, inputContext: JSON.stringify(inputContext) });
}

export function updateAiJob(
  id: number,
  payload: {
    status?: string;
    rawResponse?: string;
    actions?: AiAction[];
    error?: string;
  },
): Promise<void> {
  return invokeCommand<void>('ai_job_update', {
    id,
    status: payload.status,
    rawResponse: payload.rawResponse,
    actions: payload.actions ? JSON.stringify(payload.actions) : undefined,
    error: payload.error,
  });
}

export function listAiJobs(status?: string, limit?: number): Promise<AiJob[]> {
  return invokeCommand<AiJob[]>('ai_job_list', { status, limit });
}

export function listPendingActionJobs(): Promise<AiJob[]> {
  return invokeCommand<AiJob[]>('ai_job_pending_actions');
}
