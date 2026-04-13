/**
 * Tests for suggestionHarness orchestration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../titleAnalyzer', () => ({
  analyzeTitle: vi.fn(() => ({
    rawTitle: '准备周会',
    normalizedTitle: '准备周会',
    keywords: ['周会'],
    intentHints: [],
    entityHints: [],
    timeHints: [],
    englishTerms: [],
    segmentTrace: [],
  })),
}));

vi.mock('../confidenceScorer', () => ({
  computeConfidence: vi.fn(() => Promise.resolve({
    score: 0.5,
    strategy: 'hybrid',
    hasPatternMatch: false,
  })),
}));

vi.mock('../../commands/learning', () => ({
  feedbackRejectedTitles: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../candidateMerger', () => ({
  mergeCandidates: vi.fn((candidates) => candidates),
}));

vi.mock('../candidateRanker', () => ({
  rankCandidates: vi.fn(() => []),
}));

vi.mock('../retrievers', () => ({
  retrievePatternCandidates: vi.fn(() => Promise.resolve([])),
  retrieveLearningCandidates: vi.fn(() => Promise.resolve([])),
  retrieveHistoryCandidates: vi.fn(() => Promise.resolve([])),
  retrieveSiblingCandidates: vi.fn(() => Promise.resolve([])),
}));

describe('suggestionHarness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the current task id to sibling retrieval so self-titles are excluded', async () => {
    const { runHarness } = await import('../suggestionHarness');
    const { retrieveSiblingCandidates } = await import('../retrievers');

    await runHarness({
      taskId: 42,
      taskTitle: '准备周会',
      projectId: 7,
      existingSubtaskTitles: new Set<string>(),
    } as never);

    expect(retrieveSiblingCandidates).toHaveBeenCalledWith(7, 42, ['周会']);
  });
});
