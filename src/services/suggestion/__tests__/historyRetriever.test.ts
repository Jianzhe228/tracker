/**
 * Tests for historyRetriever nested template mapping.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;

vi.mock('../../commands/learning', () => ({
  historyGetTemplate: vi.fn(),
}));

describe('historyRetriever', () => {
  let retrieveHistoryCandidates: typeof import('../retrievers/historyRetriever').retrieveHistoryCandidates;
  let historyGetTemplate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.resetModules();

    const retrieverModule = await import('../retrievers/historyRetriever');
    const learningModule = await import('../../commands/learning');
    retrieveHistoryCandidates = retrieverModule.retrieveHistoryCandidates;
    historyGetTemplate = learningModule.historyGetTemplate as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it('maps history template children onto the candidate', async () => {
    historyGetTemplate.mockResolvedValueOnce([
      {
        title: '完成一套模拟试题',
        children: [
          { title: '写三篇阅读', children: [] },
          { title: '一篇翻译', children: [] },
        ],
      },
    ]);

    const result = await retrieveHistoryCandidates('四六级学习', ['四六级', '学习'], 1);

    expect(historyGetTemplate).toHaveBeenCalledWith('四六级学习', ['四六级', '学习'], 1, 2);
    expect(result).toEqual([{
      title: '完成一套模拟试题',
      sources: ['history'],
      evidence: ['from_task_subtask_history'],
      children: [
        { title: '写三篇阅读', children: [] },
        { title: '一篇翻译', children: [] },
      ],
    }]);
  });
});
