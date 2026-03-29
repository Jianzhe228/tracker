/**
 * Tests for prediction command wrappers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeCommand } from '../invoke';

// Mock invokeCommand
vi.mock('../invoke', () => ({
  invokeCommand: vi.fn().mockResolvedValue(undefined),
}));

import {
  recordTaskCreation,
  getTaskCreationHistory,
  getPredictionAnalysisContext,
  refreshPredictions,
  savePredictions,
  getPendingPredictions,
  updatePredictionStatus,
  getPredictionStats,
  cleanupExpiredPredictions,
} from '../prediction';

describe('prediction commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordTaskCreation', () => {
    it('calls invokeCommand with correct command name and payload', async () => {
      const payload = {
        taskTitle: '测试任务',
        projectId: 1,
        createdAt: '2026-03-28T10:00:00',
        isRecurringInstance: false,
      };

      await recordTaskCreation(payload);

      expect(invokeCommand).toHaveBeenCalledWith('record_task_creation', {
        payload,
      });
    });

    it('handles optional fields correctly', async () => {
      const payload = {
        taskTitle: '简单任务',
        createdAt: '2026-03-28T10:00:00',
      };

      await recordTaskCreation(payload);

      expect(invokeCommand).toHaveBeenCalledWith('record_task_creation', {
        payload,
      });
    });
  });

  describe('getTaskCreationHistory', () => {
    it('calls invokeCommand with days parameter', async () => {
      vi.mocked(invokeCommand).mockResolvedValueOnce([]);

      const result = await getTaskCreationHistory(30);

      expect(invokeCommand).toHaveBeenCalledWith('get_task_creation_history', {
        days: 30,
      });
      expect(result).toEqual([]);
    });

    it('works without days parameter', async () => {
      vi.mocked(invokeCommand).mockResolvedValueOnce([]);

      await getTaskCreationHistory();

      expect(invokeCommand).toHaveBeenCalledWith('get_task_creation_history', {
        days: undefined,
      });
    });
  });

  describe('getPredictionAnalysisContext', () => {
    it('calls invokeCommand with days parameter', async () => {
      const mockContext = {
        currentTime: '2026-03-28 10:00',
        dayOfWeek: '周六',
        days: 14,
        count: 10,
        taskList: '- 任务1',
        recentProjects: null,
      };
      vi.mocked(invokeCommand).mockResolvedValueOnce(mockContext);

      const result = await getPredictionAnalysisContext(7);

      expect(invokeCommand).toHaveBeenCalledWith(
        'get_prediction_analysis_context',
        { days: 7 }
      );
      expect(result).toEqual(mockContext);
    });
  });

  describe('savePredictions', () => {
    it('calls invokeCommand with predictions array', async () => {
      const predictions = [
        { title: '创建本周计划', reason: '每周一规划' },
        { title: '整理收集箱', reason: null },
      ];

      await savePredictions(predictions, '{}', 1);

      expect(invokeCommand).toHaveBeenCalledWith('save_predictions', {
        predictions,
        aiContext: '{}',
        sourceJobId: 1,
      });
    });

    it('handles null optional parameters', async () => {
      const predictions = [{ title: '测试任务' }];

      await savePredictions(predictions);

      expect(invokeCommand).toHaveBeenCalledWith('save_predictions', {
        predictions,
        aiContext: null,
        sourceJobId: null,
      });
    });
  });

  describe('refreshPredictions', () => {
    it('calls invokeCommand with force parameter', async () => {
      const mockResult = {
        createdCount: 2,
        skipped: false,
      };
      vi.mocked(invokeCommand).mockResolvedValueOnce(mockResult);

      const result = await refreshPredictions(true);

      expect(invokeCommand).toHaveBeenCalledWith('refresh_predictions', {
        force: true,
      });
      expect(result).toEqual(mockResult);
    });

    it('works without force parameter', async () => {
      vi.mocked(invokeCommand).mockResolvedValueOnce({
        createdCount: 0,
        skipped: true,
      });

      await refreshPredictions();

      expect(invokeCommand).toHaveBeenCalledWith('refresh_predictions', {
        force: false,
      });
    });
  });

  describe('getPendingPredictions', () => {
    it('calls invokeCommand with limit', async () => {
      vi.mocked(invokeCommand).mockResolvedValueOnce([]);

      await getPendingPredictions(5);

      expect(invokeCommand).toHaveBeenCalledWith('get_pending_predictions', {
        limit: 5,
      });
    });

    it('works without limit', async () => {
      vi.mocked(invokeCommand).mockResolvedValueOnce([]);

      await getPendingPredictions();

      expect(invokeCommand).toHaveBeenCalledWith('get_pending_predictions', {
        limit: undefined,
      });
    });
  });

  describe('updatePredictionStatus', () => {
    it('calls invokeCommand with id and status', async () => {
      await updatePredictionStatus(1, 'accepted');

      expect(invokeCommand).toHaveBeenCalledWith('update_prediction_status', {
        id: 1,
        status: 'accepted',
      });
    });

    it('handles different status values', async () => {
      for (const status of ['pending', 'notified', 'accepted', 'rejected', 'expired']) {
        vi.clearAllMocks();
        await updatePredictionStatus(1, status);
        expect(invokeCommand).toHaveBeenCalledWith('update_prediction_status', {
          id: 1,
          status,
        });
      }
    });
  });

  describe('getPredictionStats', () => {
    it('calls invokeCommand without parameters', async () => {
      const mockStats = {
        total: 10,
        pending: 3,
        accepted: 5,
        rejected: 2,
        historyCount: 100,
      };
      vi.mocked(invokeCommand).mockResolvedValueOnce(mockStats);

      const result = await getPredictionStats();

      expect(invokeCommand).toHaveBeenCalledWith('get_prediction_stats');
      expect(result).toEqual(mockStats);
    });
  });

  describe('cleanupExpiredPredictions', () => {
    it('calls invokeCommand with days parameter', async () => {
      vi.mocked(invokeCommand).mockResolvedValueOnce(5);

      const result = await cleanupExpiredPredictions(14);

      expect(invokeCommand).toHaveBeenCalledWith('cleanup_expired_predictions', {
        days: 14,
      });
      expect(result).toBe(5);
    });

    it('works without days parameter', async () => {
      vi.mocked(invokeCommand).mockResolvedValueOnce(3);

      await cleanupExpiredPredictions();

      expect(invokeCommand).toHaveBeenCalledWith('cleanup_expired_predictions', {
        days: undefined,
      });
    });
  });
});
