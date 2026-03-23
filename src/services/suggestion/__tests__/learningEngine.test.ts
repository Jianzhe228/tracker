/**
 * Tests for learningEngine module.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Ensure non-Tauri mode by default
delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;

// Mock the Tauri commands BEFORE importing the module
vi.mock('../../commands/learning', () => ({
  learnSuggest: vi.fn(),
  learnRecordBatch: vi.fn(),
}));

describe('learningEngine (non-Tauri mode)', () => {
  let suggestFromLearning: typeof import('../learningEngine').suggestFromLearning;
  let recordFeedback: typeof import('../learningEngine').recordFeedback;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
    const module = await import('../learningEngine');
    suggestFromLearning = module.suggestFromLearning;
    recordFeedback = module.recordFeedback;
  });

  describe('suggestFromLearning', () => {
    it('returns null when not in Tauri environment', async () => {
      const result = await suggestFromLearning(['keyword'], 1);
      expect(result).toBeNull();
    });

    it('returns null for empty keywords', async () => {
      const result = await suggestFromLearning([], 1);
      expect(result).toBeNull();
    });
  });

  describe('recordFeedback', () => {
    it('does nothing in non-Tauri mode', async () => {
      const { learnRecordBatch } = await import('../../commands/learning');
      await recordFeedback(['kw'], 'subtask', 1, true, 'pattern');

      expect(learnRecordBatch).not.toHaveBeenCalled();
    });

    it('does nothing for empty keywords', async () => {
      const { learnRecordBatch } = await import('../../commands/learning');
      await recordFeedback([], 'subtask', 1, true, 'pattern');

      expect(learnRecordBatch).not.toHaveBeenCalled();
    });
  });
});

describe('learningEngine (Tauri mode)', () => {
  let suggestFromLearning: typeof import('../learningEngine').suggestFromLearning;
  let recordFeedback: typeof import('../learningEngine').recordFeedback;
  let learnSuggest: ReturnType<typeof vi.fn>;
  let learnRecordBatch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Set Tauri mode BEFORE importing
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.resetModules();

    // Import after setting Tauri mode
    const learningModule = await import('../learningEngine');
    const commandsModule = await import('../../commands/learning');

    suggestFromLearning = learningModule.suggestFromLearning;
    recordFeedback = learningModule.recordFeedback;
    learnSuggest = (commandsModule.learnSuggest as ReturnType<typeof vi.fn>);
    learnRecordBatch = (commandsModule.learnRecordBatch as ReturnType<typeof vi.fn>);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  describe('suggestFromLearning', () => {
    it('returns suggestions when DB returns results', async () => {
      const dbResults = [
        { title: '子任务1', score: 5 },
        { title: '子任务2', score: 3 },
        { title: '子任务3', score: 1 },
      ];
      learnSuggest.mockResolvedValue(dbResults);

      const result = await suggestFromLearning(['项目'], 1);

      expect(result).not.toBeNull();
      expect(result!.suggestions).toEqual(['子任务1', '子任务2', '子任务3']);
      expect(result!.raw).toBe(dbResults);
    });

    it('returns result when DB returns exactly MIN_SUGGESTIONS (1)', async () => {
      learnSuggest.mockResolvedValue([
        { title: 'only one', score: 1 },
      ]);

      const result = await suggestFromLearning(['项目'], 1);

      // MIN_SUGGESTIONS=1, so 1 result is sufficient
      expect(result).not.toBeNull();
      expect(result!.suggestions).toEqual(['only one']);
    });

    it('returns null when DB returns empty array', async () => {
      learnSuggest.mockResolvedValue([]);

      const result = await suggestFromLearning(['项目'], 1);

      expect(result).toBeNull();
    });

    it('returns null for empty keywords', async () => {
      const result = await suggestFromLearning([], 1);

      expect(result).toBeNull();
      expect(learnSuggest).not.toHaveBeenCalled();
    });

    it('passes keywords, projectId, and limit to learnSuggest', async () => {
      learnSuggest.mockResolvedValue([
        { title: 'task1', score: 1 },
        { title: 'task2', score: 1 },
      ]);

      await suggestFromLearning(['kw1', 'kw2'], 123, 5);

      expect(learnSuggest).toHaveBeenCalledWith(['kw1', 'kw2'], 123, 5);
    });

    it('uses default limit of 8 when not specified', async () => {
      learnSuggest.mockResolvedValue([
        { title: 'task1', score: 1 },
        { title: 'task2', score: 1 },
      ]);

      await suggestFromLearning(['kw'], 1);

      expect(learnSuggest).toHaveBeenCalledWith(['kw'], 1, 8);
    });

    it('handles DB error gracefully (returns null)', async () => {
      learnSuggest.mockRejectedValue(new Error('DB error'));

      const result = await suggestFromLearning(['kw'], 1);

      expect(result).toBeNull();
    });

    it('handles null projectId', async () => {
      learnSuggest.mockResolvedValue([
        { title: 'task1', score: 1 },
        { title: 'task2', score: 1 },
      ]);

      await suggestFromLearning(['kw'], null);

      expect(learnSuggest).toHaveBeenCalledWith(['kw'], null, 8);
    });

    it('returns exactly MIN_SUGGESTIONS (1) when available', async () => {
      learnSuggest.mockResolvedValue([
        { title: 'task1', score: 1 },
      ]);

      const result = await suggestFromLearning(['kw'], 1);

      expect(result).not.toBeNull();
      expect(result!.suggestions).toEqual(['task1']);
    });
  });

  describe('recordFeedback', () => {
    it('records with delta=+1 for adopted suggestion with source', async () => {
      learnRecordBatch.mockResolvedValue(undefined);

      await recordFeedback(['kw1', 'kw2'], 'subtask', 1, true, 'pattern');

      expect(learnRecordBatch).toHaveBeenCalledWith(
        ['kw1', 'kw2'],
        'subtask',
        1,
        1, // delta = +1 for adopted non-manual
        'pattern',
      );
    });

    it('records with delta=+2 for manual creation (source=manual)', async () => {
      learnRecordBatch.mockResolvedValue(undefined);

      await recordFeedback(['kw'], 'subtask', 1, true, 'manual');

      expect(learnRecordBatch).toHaveBeenCalledWith(
        ['kw'],
        'subtask',
        1,
        2, // delta = +2 for manual
        'manual',
      );
    });

    it('records with delta=-1 for rejected suggestion', async () => {
      learnRecordBatch.mockResolvedValue(undefined);

      await recordFeedback(['kw'], 'subtask', 1, false, 'ai');

      expect(learnRecordBatch).toHaveBeenCalledWith(
        ['kw'],
        'subtask',
        1,
        -1, // delta = -1 for rejected
        'ai',
      );
    });

    it('records with delta=-1 when source is omitted and adopted=false', async () => {
      learnRecordBatch.mockResolvedValue(undefined);

      await recordFeedback(['kw'], 'subtask', 1, false);

      expect(learnRecordBatch).toHaveBeenCalledWith(
        ['kw'],
        'subtask',
        1,
        -1,
        undefined,
      );
    });

    it('records with delta=+1 when source is omitted and adopted=true', async () => {
      learnRecordBatch.mockResolvedValue(undefined);

      await recordFeedback(['kw'], 'subtask', 1, true);

      expect(learnRecordBatch).toHaveBeenCalledWith(
        ['kw'],
        'subtask',
        1,
        1, // defaults to +1 when adopted=true without source
        undefined,
      );
    });

    it('does nothing for empty keywords', async () => {
      await recordFeedback([], 'subtask', 1, true, 'pattern');

      expect(learnRecordBatch).not.toHaveBeenCalled();
    });

    it('handles null projectId', async () => {
      learnRecordBatch.mockResolvedValue(undefined);

      await recordFeedback(['kw'], 'subtask', null, true, 'pattern');

      expect(learnRecordBatch).toHaveBeenCalledWith(['kw'], 'subtask', null, 1, 'pattern');
    });

    it('handles multiple keywords (records batch for all)', async () => {
      learnRecordBatch.mockResolvedValue(undefined);

      await recordFeedback(['kw1', 'kw2', 'kw3'], 'subtask', 1, true, 'learning');

      expect(learnRecordBatch).toHaveBeenCalledWith(
        ['kw1', 'kw2', 'kw3'],
        'subtask',
        1,
        1,
        'learning',
      );
    });

    it('handles DB error gracefully (does not throw)', async () => {
      learnRecordBatch.mockRejectedValue(new Error('DB error'));

      await expect(
        recordFeedback(['kw'], 'subtask', 1, true, 'pattern'),
      ).resolves.toBeUndefined();
    });

    it('handles various source types', async () => {
      learnRecordBatch.mockResolvedValue(undefined);

      await recordFeedback(['kw'], 'subtask', 1, true, 'pattern');
      expect(learnRecordBatch).toHaveBeenCalledWith(['kw'], 'subtask', 1, 1, 'pattern');

      await recordFeedback(['kw'], 'subtask', 1, true, 'learning');
      expect(learnRecordBatch).toHaveBeenCalledWith(['kw'], 'subtask', 1, 1, 'learning');

      await recordFeedback(['kw'], 'subtask', 1, true, 'ai');
      expect(learnRecordBatch).toHaveBeenCalledWith(['kw'], 'subtask', 1, 1, 'ai');

      await recordFeedback(['kw'], 'subtask', 1, true, 'manual');
      expect(learnRecordBatch).toHaveBeenCalledWith(['kw'], 'subtask', 1, 2, 'manual');
    });
  });
});
