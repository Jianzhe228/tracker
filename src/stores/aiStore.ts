import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { AiSkill, AiJob, AiAction } from '../services/ai/types';
import { listAiSkills, listPendingActionJobs, updateAiJob, toggleAiSkill as toggleAiSkillCmd, updateAiSkill as updateAiSkillCmd, createAiSkill as createAiSkillCmd } from '../services/commands/ai';
import { enqueue, invalidateSkillCache, getProcessingCount } from '../services/ai/queue';
import { executeAction } from '../services/ai/actionExecutor';
import { extractKeywords, recordFeedback } from '../services/suggestion';

const isTauri = '__TAURI_INTERNALS__' in window;

export const useAiStore = defineStore('ai', () => {
  const skills = ref<AiSkill[]>([]);
  const pendingJobs = ref<AiJob[]>([]);
  const processingCount = ref(0);

  let pollInterval: ReturnType<typeof setInterval> | null = null;

  async function loadSkills(): Promise<void> {
    if (!isTauri) return;
    try {
      skills.value = await listAiSkills();
      invalidateSkillCache();
    } catch (e) {
      console.error('[ai-store] failed to load skills', e);
    }
  }

  async function loadPendingJobs(): Promise<void> {
    if (!isTauri) return;
    try {
      pendingJobs.value = await listPendingActionJobs();
    } catch (e) {
      console.error('[ai-store] failed to load pending jobs', e);
    }
  }

  async function init(): Promise<void> {
    await loadSkills();
    await loadPendingJobs();
    // Poll for pending jobs every 10s
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
      processingCount.value = getProcessingCount();
      void loadPendingJobs();
    }, 10_000);
  }

  async function submitJob(skillKey: string, context: Record<string, unknown>): Promise<void> {
    processingCount.value = 1;
    const job = await enqueue(skillKey, context);
    processingCount.value = getProcessingCount();
    if (job && job.status === 'completed' && job.actions && job.actions.length > 0) {
      pendingJobs.value = [job, ...pendingJobs.value.filter((j) => j.id !== job.id)];
    }
  }

  async function approveJob(jobId: number): Promise<void> {
    const job = pendingJobs.value.find((j) => j.id === jobId);
    if (!job || !job.actions) return;

    const context = job.inputContext;
    for (const action of job.actions) {
      if (action.status === 'pending') {
        try {
          await executeAction(action, context);
          action.status = 'executed';
        } catch (e) {
          console.error('[ai-store] failed to execute action', e);
        }
      }
    }

    try {
      await updateAiJob(jobId, { actions: job.actions });
    } catch {
      // Non-fatal
    }

    pendingJobs.value = pendingJobs.value.filter((j) => j.id !== jobId);
  }

  async function rejectJob(jobId: number): Promise<void> {
    const job = pendingJobs.value.find((j) => j.id === jobId);
    if (!job || !job.actions) return;

    for (const action of job.actions) {
      if (action.status === 'pending') {
        action.status = 'rejected';
      }
    }

    try {
      await updateAiJob(jobId, { actions: job.actions });
    } catch {
      // Non-fatal
    }

    pendingJobs.value = pendingJobs.value.filter((j) => j.id !== jobId);
  }

  async function approveAction(jobId: number, actionIdx: number): Promise<void> {
    const job = pendingJobs.value.find((j) => j.id === jobId);
    if (!job || !job.actions || !job.actions[actionIdx]) return;

    const action = job.actions[actionIdx];
    if (action.status !== 'pending') return;

    try {
      await executeAction(action, job.inputContext);
      action.status = 'executed';
    } catch (e) {
      console.error('[ai-store] failed to execute action', e);
      return;
    }

    // Record positive learning feedback for create_subtask actions
    if (action.type === 'create_subtask' && action.params.title) {
      const taskTitle = String(job.inputContext.taskTitle ?? '');
      const projectId = (job.inputContext.projectId as number | undefined) ?? null;
      const keywords = extractKeywords(taskTitle);
      recordFeedback(keywords, String(action.params.title), projectId, true, 'ai');
    }

    // If all actions resolved, remove job from pending
    const allResolved = job.actions.every((a) => a.status !== 'pending');
    if (allResolved) {
      pendingJobs.value = pendingJobs.value.filter((j) => j.id !== jobId);
    }

    try {
      await updateAiJob(jobId, { actions: job.actions });
    } catch {
      // Non-fatal
    }
  }

  async function rejectAction(jobId: number, actionIdx: number): Promise<void> {
    const job = pendingJobs.value.find((j) => j.id === jobId);
    if (!job || !job.actions || !job.actions[actionIdx]) return;

    const action = job.actions[actionIdx];
    if (action.status !== 'pending') return;
    action.status = 'rejected';

    // Record negative learning feedback for create_subtask actions
    if (action.type === 'create_subtask' && action.params.title) {
      const taskTitle = String(job.inputContext.taskTitle ?? '');
      const projectId = (job.inputContext.projectId as number | undefined) ?? null;
      const keywords = extractKeywords(taskTitle);
      recordFeedback(keywords, String(action.params.title), projectId, false, 'ai');
    }

    const allResolved = job.actions.every((a) => a.status !== 'pending');
    if (allResolved) {
      pendingJobs.value = pendingJobs.value.filter((j) => j.id !== jobId);
    }

    try {
      await updateAiJob(jobId, { actions: job.actions });
    } catch {
      // Non-fatal
    }
  }

  async function toggleSkill(id: number, enabled: boolean): Promise<void> {
    if (!isTauri) return;
    try {
      await toggleAiSkillCmd(id, enabled);
      const skill = skills.value.find((s) => s.id === id);
      if (skill) skill.enabled = enabled;
      invalidateSkillCache();
    } catch (e) {
      console.error('[ai-store] failed to toggle skill', e);
    }
  }

  async function saveSkillPrompts(id: number, systemPrompt: string, userPromptTemplate: string): Promise<void> {
    if (!isTauri) return;
    try {
      await updateAiSkillCmd(id, { systemPrompt, userPromptTemplate } as Partial<AiSkill>);
      const skill = skills.value.find((s) => s.id === id);
      if (skill) {
        skill.systemPrompt = systemPrompt;
        skill.userPromptTemplate = userPromptTemplate;
      }
      invalidateSkillCache();
    } catch (e) {
      console.error('[ai-store] failed to save skill prompts', e);
    }
  }

  async function addSkill(data: { key: string; name: string; description: string; systemPrompt: string; userPromptTemplate: string; actionTypes: string[]; triggerType: string }): Promise<void> {
    if (!isTauri) return;
    try {
      const created = await createAiSkillCmd(data as Partial<AiSkill>);
      skills.value.push(created);
      invalidateSkillCache();
    } catch (e) {
      console.error('[ai-store] failed to create skill', e);
    }
  }

  return {
    skills,
    pendingJobs,
    processingCount,
    loadSkills,
    loadPendingJobs,
    init,
    submitJob,
    approveJob,
    rejectJob,
    approveAction,
    rejectAction,
    toggleSkill,
    saveSkillPrompts,
    addSkill,
  };
});
