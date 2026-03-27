/**
 * AI job queue — async serial processing of AI skill invocations.
 */
import type { AiSkill, AiJob, AiAction } from './types';
import { callChatCompletion, type ChatMessage } from './client';
import { renderPrompt } from './promptEngine';
import {
  listAiSkills,
  createAiJob,
  updateAiJob,
} from '../commands/ai';
import { useSettingsStore } from '../../stores/settingsStore';

const JOB_TIMEOUT = 15_000;

type JobQueueItem = {
  skillKey: string;
  inputContext: Record<string, unknown>;
  resolve: (job: AiJob | null) => void;
  reject: (reason: Error) => void;
};

let queue: JobQueueItem[] = [];
let processingPromise: Promise<void> | null = null;
let processingResolver: (() => void) | null = null;
let cachedSkills: AiSkill[] | null = null;

export function getProcessingCount(): number {
  return processingPromise !== null ? 1 : 0;
}

async function loadSkills(): Promise<AiSkill[]> {
  if (cachedSkills) return cachedSkills;
  try {
    cachedSkills = await listAiSkills();
  } catch {
    cachedSkills = [];
  }
  return cachedSkills;
}

export function invalidateSkillCache(): void {
  cachedSkills = null;
}

async function doProcessQueue(): Promise<void> {
  while (queue.length > 0) {
    const item = queue.shift()!;
    try {
      const job = await processJob(item.skillKey, item.inputContext);
      item.resolve(job);
    } catch (e) {
      console.error('[ai-queue] job failed', e);
      item.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

async function processQueue(): Promise<void> {
  if (processingPromise) return;
  let resolveProcessing: (() => void) | undefined;
  processingPromise = new Promise<void>((resolve) => {
    resolveProcessing = resolve;
  });
  try {
    await doProcessQueue();
  } finally {
    resolveProcessing?.();
    processingPromise = null;
  }
}

async function processJob(
  skillKey: string,
  inputContext: Record<string, unknown>,
): Promise<AiJob | null> {
  const skills = await loadSkills();
  const skill = skills.find((s) => s.key === skillKey && s.enabled);
  if (!skill) return null;

  const settingsStore = useSettingsStore();
  const { endpoint, apiKey, model } = settingsStore.ai;
  if (!endpoint || !apiKey) return null;

  // Create DB record
  let job: AiJob;
  try {
    job = await createAiJob(skill.id, inputContext);
  } catch (e) {
    console.error('[ai-queue] failed to create job', e);
    return null;
  }

  // Update status to running
  try {
    await updateAiJob(job.id, { status: 'running' });
    job.status = 'running';
  } catch {
    // Non-fatal
  }

  // Build messages
  const systemPrompt = skill.systemPrompt;
  const userPrompt = renderPrompt(skill.userPromptTemplate, inputContext);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const rawResult = await callChatCompletion(
      endpoint,
      apiKey,
      model || 'gpt-4o-mini',
      messages,
      JOB_TIMEOUT,
    );

    const rawResponse = JSON.stringify(rawResult);
    const actions = parseActions(rawResult, skill.actionTypes);

    await updateAiJob(job.id, {
      status: 'completed',
      rawResponse,
      actions,
    });

    return {
      ...job,
      status: 'completed',
      rawResponse,
      actions,
      completedAt: new Date().toISOString(),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await updateAiJob(job.id, {
      status: 'failed',
      error,
    }).catch((e) => console.warn('[ai-queue] failed to update failed job', e));

    return {
      ...job,
      status: 'failed',
      error,
      completedAt: new Date().toISOString(),
    };
  }
}

function parseActions(
  result: Record<string, unknown>,
  allowedTypes: string[],
): AiAction[] {
  let rawActions: unknown[] | undefined;

  if (Array.isArray(result.actions)) {
    rawActions = result.actions;
  } else if (Array.isArray(result.suggestedSubtasks)) {
    // Backward compat: old format from taskAssistant
    rawActions = (result.suggestedSubtasks as string[]).map((title) => ({
      type: 'create_subtask',
      params: { title },
    }));
  }

  if (!rawActions) return [];

  const allowed = new Set(allowedTypes);

  return rawActions
    .filter((item): item is { type: string; params?: Record<string, unknown> } => {
      if (typeof item !== 'object' || item === null) return false;
      const obj = item as Record<string, unknown>;
      return typeof obj.type === 'string' && allowed.has(obj.type as string);
    })
    .slice(0, 20)
    .map((item) => ({
      type: item.type,
      params: (typeof item.params === 'object' && item.params !== null
        ? item.params
        : {}) as Record<string, unknown>,
      status: 'pending' as const,
    }));
}

export function enqueue(
  skillKey: string,
  inputContext: Record<string, unknown>,
): Promise<AiJob | null> {
  return new Promise((resolve, reject) => {
    queue.push({ skillKey, inputContext, resolve, reject });
    void processQueue();
  });
}
