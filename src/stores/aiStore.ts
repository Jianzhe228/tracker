import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { AiSkill, AiJob, AiAction } from '../services/ai/types';
import { listAiSkills, listPendingActionJobs, updateAiJob, toggleAiSkill as toggleAiSkillCmd, updateAiSkill as updateAiSkillCmd, createAiSkill as createAiSkillCmd } from '../services/commands/ai';
import { enqueue, invalidateSkillCache, getProcessingCount } from '../services/ai/queue';
import { executeAction } from '../services/ai/actionExecutor';
import { extractKeywords, recordFeedback } from '../services/suggestion';
import { feedbackRecord } from '../services/commands/learning';
import { refreshKnownKeywords } from '../services/suggestion/keywordCache';
import { partitionPendingJobs, rejectPendingActions, shouldShowPendingJob } from './aiPendingJobs';
import { useTaskStore } from './taskStore';
import { useUiStore } from './uiStore';

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
      if (skills.value.length === 0) {
        await loadSkills();
      }
      const jobs = await listPendingActionJobs();
      const skillKeyById = new Map(skills.value.map((skill) => [skill.id, skill.key]));
      const notificationJobs = jobs.filter((job) => shouldShowPendingJob(job, skillKeyById.get(job.skillId)));
      const { visibleJobs, supersededJobs } = partitionPendingJobs(notificationJobs);
      pendingJobs.value = visibleJobs;

      for (const job of supersededJobs) {
        const actions = rejectPendingActions(job.actions);
        if (!actions) continue;
        updateAiJob(job.id, { actions }).catch((e) => {
          console.warn('[ai-store] failed to dismiss superseded job', e);
        });
      }
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

  function dispose(): void {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  async function submitJob(skillKey: string, context: Record<string, unknown>): Promise<void> {
    processingCount.value = 1;
    const job = await enqueue(skillKey, context);
    processingCount.value = getProcessingCount();
    if (
      job &&
      job.status === 'completed' &&
      job.actions &&
      job.actions.length > 0 &&
      shouldShowPendingJob(job, skillKey)
    ) {
      pendingJobs.value = [job, ...pendingJobs.value.filter((j) => j.id !== job.id)];
    }
  }

  async function approveJob(jobId: number): Promise<void> {
    const job = pendingJobs.value.find((j) => j.id === jobId);
    if (!job || !job.actions) return;

    const context = job.inputContext;
    const taskStore = useTaskStore();
    let failures = 0;
    for (const action of job.actions) {
      if (action.status === 'pending') {
        try {
          await executeAction(action, context, taskStore);
          action.status = 'executed';
        } catch (e) {
          action.status = 'failed';
          failures++;
          console.error('[ai-store] failed to execute action', e);
        }
      }
    }

    try {
      await updateAiJob(jobId, { actions: job.actions });
    } catch {
      // Non-fatal
    }

    const hasPending = job.actions.some((a: AiAction) => a.status === 'pending');
    if (!hasPending) {
      pendingJobs.value = pendingJobs.value.filter((j) => j.id !== jobId);
    }

    if (failures > 0) {
      try {
        useUiStore().notify(`${failures} 个 AI 动作执行失败`);
      } catch {
        // uiStore may not be available in tests
      }
    }
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
      await executeAction(action, job.inputContext, useTaskStore());
      action.status = 'executed';
    } catch (e) {
      console.error('[ai-store] failed to execute action', e);
      return;
    }

    // Record positive learning feedback for create_subtask actions
    if (action.type === 'create_subtask' && action.params.title) {
      const taskTitle = String(job.inputContext.taskTitle ?? '');
      const projectId = (job.inputContext.projectId as number | undefined) ?? null;
      const taskId = (job.inputContext.taskId as number | undefined) ?? 0;
      const keywords = extractKeywords(taskTitle);
      recordFeedback(keywords, String(action.params.title), projectId, true, 'ai');
      // Record to suggestion_feedback table
      feedbackRecord({
        taskId,
        taskTitle,
        projectId,
        suggestionTitle: String(action.params.title),
        source: 'ai',
        action: 'accepted',
        jobId: jobId,
      }).catch((e) => console.warn('[ai-store] failed to record feedback', e));
      // Refresh keyword cache after feedback
      refreshKnownKeywords().catch((e) => console.warn('[ai-store] failed to refresh keywords', e));
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
      const taskId = (job.inputContext.taskId as number | undefined) ?? 0;
      const keywords = extractKeywords(taskTitle);
      recordFeedback(keywords, String(action.params.title), projectId, false, 'ai');
      // Record to suggestion_feedback table
      feedbackRecord({
        taskId,
        taskTitle,
        projectId,
        suggestionTitle: String(action.params.title),
        source: 'ai',
        action: 'rejected',
        jobId: jobId,
      }).catch((e) => console.warn('[ai-store] failed to record rejection', e));
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
    dispose,
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
