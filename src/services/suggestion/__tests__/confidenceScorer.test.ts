/**
 * Tests for confidenceScorer module.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Ensure non-Tauri mode by default
delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;

// Mock the Tauri commands BEFORE importing
vi.mock('../../commands/learning', () => ({
  learnStats: vi.fn(),
}));

vi.mock('../patternMatcher', () => ({
  matchPatterns: vi.fn(),
}));

describe('confidenceScorer (non-Tauri mode)', () => {
  let computeConfidence: typeof import('../confidenceScorer').computeConfidence;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
    const module = await import('../confidenceScorer');
    computeConfidence = module.computeConfidence;
  });

  it('returns ai strategy with score 0 when not in Tauri environment', async () => {
    const result = await computeConfidence(['keyword'], 1);

    expect(result.score).toBe(0);
    expect(result.strategy).toBe('ai');
    expect(result.hasPatternMatch).toBe(false);
  });

  it('returns ai strategy for empty keywords', async () => {
    const result = await computeConfidence([], 1);

    expect(result.score).toBe(0);
    expect(result.strategy).toBe('ai');
    expect(result.hasPatternMatch).toBe(false);
  });
});

describe('confidenceScorer (Tauri mode)', () => {
  let computeConfidence: typeof import('../confidenceScorer').computeConfidence;
  let learnStats: ReturnType<typeof vi.fn>;
  let matchPatterns: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.resetModules();

    const confidenceModule = await import('../confidenceScorer');
    const learningModule = await import('../../commands/learning');
    const patternModule = await import('../patternMatcher');

    computeConfidence = confidenceModule.computeConfidence;
    learnStats = (learningModule.learnStats as ReturnType<typeof vi.fn>);
    matchPatterns = (patternModule.matchPatterns as ReturnType<typeof vi.fn>);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  describe('score calculation', () => {
    it('calculates score with all factors at maximum', async () => {
      learnStats.mockResolvedValue({
        matchCount: 5,
        maxScore: 10,
        totalFeedback: 100,
        historyCount: 3,
      });
      matchPatterns.mockResolvedValue({
        pattern: { id: 1, name: 'Test', subtasks: [] },
        subtasks: ['a', 'b'],
      });

      const result = await computeConfidence(['kw'], 1);

      expect(result.score).toBe(1.0);
      expect(result.strategy).toBe('local');
      expect(result.hasPatternMatch).toBe(true);
    });

    it('calculates score with all factors at minimum (zero)', async () => {
      learnStats.mockResolvedValue({
        matchCount: 0,
        maxScore: 0,
        totalFeedback: 0,
        historyCount: 0,
      });
      matchPatterns.mockResolvedValue(null);

      const result = await computeConfidence(['kw'], 1);

      expect(result.score).toBe(0);
      expect(result.strategy).toBe('ai');
      expect(result.hasPatternMatch).toBe(false);
    });

    it('normalizes matchCount (caps at MAX_MATCH_COUNT=5)', async () => {
      learnStats.mockResolvedValue({
        matchCount: 100,
        maxScore: 0,
        totalFeedback: 0,
        historyCount: 0,
      });
      matchPatterns.mockResolvedValue(null);

      const result = await computeConfidence(['kw'], 1);

      expect(result.score).toBe(0.35);
    });

    it('normalizes maxScore (caps at MAX_SCORE=10)', async () => {
      learnStats.mockResolvedValue({
        matchCount: 0,
        maxScore: 50,
        totalFeedback: 0,
        historyCount: 0,
      });
      matchPatterns.mockResolvedValue(null);

      const result = await computeConfidence(['kw'], 1);

      expect(result.score).toBe(0.20);
    });

    it('normalizes historyCount (caps at MAX_HISTORY=3)', async () => {
      learnStats.mockResolvedValue({
        matchCount: 0,
        maxScore: 0,
        totalFeedback: 0,
        historyCount: 10,
      });
      matchPatterns.mockResolvedValue(null);

      const result = await computeConfidence(['kw'], 1);

      expect(result.score).toBeCloseTo(0.25, 2);
    });

    it('calculates mixed score correctly', async () => {
      learnStats.mockResolvedValue({
        matchCount: 2,
        maxScore: 5,
        totalFeedback: 10,
        historyCount: 1,
      });
      matchPatterns.mockResolvedValue(null);

      const result = await computeConfidence(['kw'], 1);

      expect(result.score).toBeCloseTo(0.323, 2);
    });

    it('adds pattern bonus when pattern matches', async () => {
      learnStats.mockResolvedValue({
        matchCount: 0,
        maxScore: 0,
        totalFeedback: 0,
        historyCount: 0,
      });
      matchPatterns.mockResolvedValue({
        pattern: { id: 1, name: 'Test', subtasks: [] },
        subtasks: ['a'],
      });

      const result = await computeConfidence(['kw'], 1);

      expect(result.score).toBe(0.20);
      expect(result.hasPatternMatch).toBe(true);
    });

    it('handles pattern match with empty subtasks (no match)', async () => {
      learnStats.mockResolvedValue({
        matchCount: 0,
        maxScore: 0,
        totalFeedback: 0,
        historyCount: 0,
      });
      matchPatterns.mockResolvedValue({
        pattern: { id: 1, name: 'Test', subtasks: [] },
        subtasks: [],
      });

      const result = await computeConfidence(['kw'], 1);

      expect(result.hasPatternMatch).toBe(false);
      expect(result.score).toBe(0);
    });
  });

  describe('strategy thresholds', () => {
    it('returns local strategy when score >= 0.7', async () => {
      learnStats.mockResolvedValue({
        matchCount: 4,
        maxScore: 8,
        totalFeedback: 50,
        historyCount: 2,
      });
      matchPatterns.mockResolvedValue({
        pattern: { id: 1, name: 'Test', subtasks: ['a'] },
        subtasks: ['a'],
      });

      const result = await computeConfidence(['kw'], 1);

      expect(result.strategy).toBe('local');
    });

    it('returns hybrid strategy when 0.3 <= score < 0.7', async () => {
      learnStats.mockResolvedValue({
        matchCount: 2,
        maxScore: 5,
        totalFeedback: 10,
        historyCount: 1,
      });
      matchPatterns.mockResolvedValue(null);

      const result = await computeConfidence(['kw'], 1);

      expect(result.strategy).toBe('hybrid');
    });

    it('returns ai strategy when score < 0.3', async () => {
      learnStats.mockResolvedValue({
        matchCount: 0,
        maxScore: 1,
        totalFeedback: 1,
        historyCount: 0,
      });
      matchPatterns.mockResolvedValue(null);

      const result = await computeConfidence(['kw'], 1);

      expect(result.strategy).toBe('ai');
    });

    it('boundary: score >= 0.7 returns local', async () => {
      learnStats.mockResolvedValue({
        matchCount: 4,
        maxScore: 7,
        totalFeedback: 20,
        historyCount: 2,
      });
      matchPatterns.mockResolvedValue({
        pattern: { id: 1, name: 'Test', subtasks: ['a'] },
        subtasks: ['a'],
      });

      const result = await computeConfidence(['kw'], 1);

      // 0.8*0.35 + 0.7*0.20 + 0.667*0.25 + 1*0.20 = 0.28+0.14+0.167+0.20 = 0.787
      expect(result.score).toBeGreaterThanOrEqual(0.7);
      expect(result.strategy).toBe('local');
    });

    it('boundary: score in hybrid range returns hybrid', async () => {
      learnStats.mockResolvedValue({
        matchCount: 2,
        maxScore: 4,
        totalFeedback: 5,
        historyCount: 1,
      });
      matchPatterns.mockResolvedValue(null);

      const result = await computeConfidence(['kw'], 1);

      expect(result.score).toBeGreaterThan(0.3);
      expect(result.strategy).toBe('hybrid');
    });
  });

  describe('error handling', () => {
    it('returns ai strategy when DB query fails', async () => {
      learnStats.mockRejectedValue(new Error('DB error'));

      const result = await computeConfidence(['kw'], 1);

      expect(result.score).toBe(0);
      expect(result.strategy).toBe('ai');
      expect(result.hasPatternMatch).toBe(false);
    });

    it('handles null projectId', async () => {
      learnStats.mockResolvedValue({
        matchCount: 0,
        maxScore: 0,
        totalFeedback: 0,
        historyCount: 0,
      });
      matchPatterns.mockResolvedValue(null);

      const result = await computeConfidence(['kw'], null);

      expect(learnStats).toHaveBeenCalledWith(['kw'], null);
      expect(matchPatterns).toHaveBeenCalledWith(['kw'], null);
      expect(result.strategy).toBe('ai');
    });
  });

  describe('parallel queries', () => {
    it('queries learnStats and matchPatterns in parallel', async () => {
      let learnResolve: () => void;
      let patternResolve: () => void;

      learnStats.mockImplementationOnce(
        () => new Promise((r) => { learnResolve = r as unknown as () => void; })
      );
      matchPatterns.mockImplementationOnce(
        () => new Promise((r) => { patternResolve = r as unknown as () => void; })
      );

      const promise = computeConfidence(['kw'], 1);

      // Both should be in flight
      expect(learnStats).toHaveBeenCalled();
      expect(matchPatterns).toHaveBeenCalled();

      // Resolve both
      learnStats.mockResolvedValue({
        matchCount: 0,
        maxScore: 0,
        totalFeedback: 0,
        historyCount: 0,
      });
      matchPatterns.mockResolvedValue(null);
      learnResolve!();
      patternResolve!();

      await promise;
    });
  });
});
