/**
 * Tests for predictionStore: basic state management.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Mock Tauri environment
Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {} });

const taskStoreMock = {
  addTask: vi.fn().mockResolvedValue({ id: 1, title: '新任务' }),
};

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
  refreshPredictions: vi.fn().mockResolvedValue({
    createdCount: 1,
    skipped: false,
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
  useTaskStore: () => taskStoreMock,
}));

import { usePredictionStore } from '../predictionStore';

describe('predictionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskStoreMock.addTask.mockResolvedValue({ id: 1, title: '新任务' });
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

  describe('refreshPredictions', () => {
    it('sets isAnalyzing to true during refresh', async () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      const analysisPromise = store.refreshPredictions();
      expect(store.isAnalyzing).toBe(true);
      await analysisPromise;
      expect(store.isAnalyzing).toBe(false);
    });

    it('calls backend prediction refresh command', async () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      const { refreshPredictions } = await import('../../services/commands/prediction');

      await store.refreshPredictions();

      expect(refreshPredictions).toHaveBeenCalledWith(false);
    });

    it('updates lastAnalysisAt after successful refresh', async () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      await store.refreshPredictions();

      expect(store.lastAnalysisAt).not.toBeNull();
    });

    it('sends notifications for new predictions', async () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      const predictionCommands = await import('../../services/commands/prediction');
      const notificationModule = await import('../../services/notification');
      vi.mocked(predictionCommands.getPendingPredictions).mockResolvedValueOnce([
        {
          id: 1,
          title: '本周计划',
          reason: '过去 4 周里你有 3 次在周一上午创建过类似任务',
          predictedForDate: '2026-03-29',
          createdAt: '2026-03-29 10:00:00',
          notifiedAt: null,
          status: 'pending',
          aiContext: null,
          sourceJobId: null,
          projectId: 1,
          titleKey: '本周计划',
          score: 9.2,
          scoreBreakdown: '{"frequency":4}',
          algorithmVersion: 'local-v1',
        },
      ]);

      await store.refreshPredictions();

      expect(notificationModule.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'prediction',
          title: '今日任务预测',
        })
      );
    });

    it('resets isAnalyzing even when refresh fails', async () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      const { refreshPredictions } = await import('../../services/commands/prediction');
      vi.mocked(refreshPredictions).mockRejectedValueOnce(new Error('Refresh failed'));

      await store.refreshPredictions();

      expect(store.isAnalyzing).toBe(false);
    });
  });

  describe('acceptPrediction', () => {
    it('creates the task with the predicted project and today due date', async () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      store.pendingPredictions = [
        {
          id: 7,
          title: '写周报',
          reason: '最近常在周五创建',
          predictedForDate: '2026-03-29',
          createdAt: '2026-03-29 10:00:00',
          notifiedAt: null,
          status: 'pending',
          aiContext: null,
          sourceJobId: null,
          projectId: 1,
          titleKey: '写周报',
          score: 7.5,
          scoreBreakdown: null,
          algorithmVersion: 'local-v1',
        },
      ];

      await store.acceptPrediction(7);

      expect(taskStoreMock.addTask).toHaveBeenCalledWith(
        '写周报',
        expect.objectContaining({
          projectId: 1,
          dueAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        })
      );
    });

    it('skips prediction record to avoid self-reinforcing loop', async () => {
      setActivePinia(createPinia());
      const store = usePredictionStore();

      store.pendingPredictions = [
        {
          id: 8,
          title: '写周报',
          reason: null,
          predictedForDate: '2026-03-29',
          createdAt: '2026-03-29 10:00:00',
          notifiedAt: null,
          status: 'pending',
          aiContext: null,
          sourceJobId: null,
          projectId: 1,
          titleKey: '写周报',
          score: 7.5,
          scoreBreakdown: null,
          algorithmVersion: 'local-v1',
        },
      ];

      await store.acceptPrediction(8);

      expect(taskStoreMock.addTask).toHaveBeenCalledWith(
        '写周报',
        expect.objectContaining({ skipPredictionRecord: true }),
      );
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
