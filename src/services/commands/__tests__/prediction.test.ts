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
  refreshPredictions,
  getPendingPredictions,
  updatePredictionStatus,
  getPredictionStats,
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

  describe('refreshPredictions', () => {
    it('calls invokeCommand with force parameter', async () => {
      const mockResult = {
        createdCount: 2,
        createdIds: [11, 12],
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
        createdIds: [],
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
});
