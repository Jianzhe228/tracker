/**
 * Tests for predictionStore: basic state management.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Mock Tauri environment
Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {} });

// Mock modules
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../services/commands/prediction', () => ({
  getPendingPredictions: vi.fn().mockResolvedValue([]),
  getPredictionStats: vi.fn().mockResolvedValue({
    total: 0,
    pending: 0,
    accepted: 0,
    rejected: 0,
    historyCount: 0,
  }),
  getPredictionAnalysisContext: vi.fn().mockResolvedValue({
    currentTime: '2026-03-28 10:00',
    dayOfWeek: '周六',
    days: 14,
    count: 10,
    taskList: '- 任务1\n- 任务2',
    recentProjects: '项目1, 项目2',
  }),
  savePredictions: vi.fn().mockResolvedValue([1, 2]),
  updatePredictionStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/ai/queue', () => ({
  enqueue: vi.fn().mockResolvedValue({
    id: 1,
    status: 'completed',
    rawResponse: JSON.stringify({
      predictions: [
        { title: '创建本周计划', reason: '你每周一常规划本周工作' },
      ],
    }),
  }),
}));

vi.mock('../../services/notification', () => ({
  sendNotification: vi.fn(),
}));

vi.mock('../settingsStore', () => ({
  useSettingsStore: () => ({
    ai: {
      endpoint: 'https://api.openai.com',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    },
  }),
}));

vi.mock('../taskStore', () => ({
  useTaskStore: () => ({
    addTask: vi.fn().mockResolvedValue({ id: 1, title: '新任务' }),
  }),
}));

import { usePredictionStore } from '../predictionStore';

describe('predictionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts with empty pending predictions', () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();
      expect(store.pendingPredictions).toEqual([]);
    });

    it('starts with null stats', () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();
      expect(store.stats).toBeNull();
    });

    it('starts not analyzing', () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();
      expect(store.isAnalyzing).toBe(false);
    });

    it('has no pending count initially', () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();
      expect(store.pendingCount).toBe(0);
      expect(store.hasPending).toBe(false);
    });

    it('starts with null lastAnalysisAt', () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();
      expect(store.lastAnalysisAt).toBeNull();
    });
  });

  describe('computed properties', () => {
    it('hasPending is false when no pending predictions', async () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      const { getPendingPredictions } = await import(
        '../../services/commands/prediction'
      );
      vi.mocked(getPendingPredictions).mockResolvedValueOnce([]);

      await store.loadPendingPredictions();

      expect(store.hasPending).toBe(false);
      expect(store.pendingCount).toBe(0);
    });
  });

  describe('triggerAnalysis', () => {
    it('sets isAnalyzing to true during analysis', async () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      // The analysis is async, so isAnalyzing should be true during the call
      const analysisPromise = store.triggerAnalysis();
      expect(store.isAnalyzing).toBe(true);
      await analysisPromise;
      expect(store.isAnalyzing).toBe(false);
    });

    it('calls AI queue with task_history_analyzer skill', async () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      const { enqueue } = await import('../../services/ai/queue');

      await store.triggerAnalysis();

      expect(enqueue).toHaveBeenCalledWith(
        'task_history_analyzer',
        expect.objectContaining({
          days: 14,
        })
      );
    });

    it('updates lastAnalysisAt after successful analysis', async () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      await store.triggerAnalysis();

      expect(store.lastAnalysisAt).not.toBeNull();
    });

    it('resets isAnalyzing even when AI call fails', async () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      const { enqueue } = await import('../../services/ai/queue');
      vi.mocked(enqueue).mockRejectedValueOnce(new Error('Network error'));

      await store.triggerAnalysis();

      expect(store.isAnalyzing).toBe(false);
    });
  });

  describe('stopListening', () => {
    it('does not throw when called multiple times', () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      expect(() => store.stopListening()).not.toThrow();
      expect(() => store.stopListening()).not.toThrow();
    });
  });
});
