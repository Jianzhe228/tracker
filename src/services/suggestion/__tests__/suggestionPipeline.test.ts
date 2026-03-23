/**
 * Tests for suggestionPipeline module.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Ensure non-Tauri mode by default
delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;

// Mock all dependencies BEFORE importing
vi.mock('../patternMatcher', () => ({
  matchPatterns: vi.fn(),
}));

vi.mock('../learningEngine', () => ({
  suggestFromLearning: vi.fn(),
}));

vi.mock('../confidenceScorer', () => ({
  computeConfidence: vi.fn(),
}));

vi.mock('../../commands/learning', () => ({
  historySuggest: vi.fn(),
  feedbackRejectedTitles: vi.fn(),
}));

vi.mock('../keywordExtractor', () => ({
  extractKeywords: vi.fn((title: string) => {
    // Simple mock: return non-empty keywords for non-empty titles
    if (!title || title === '!!!') return [];
    return ['keyword'];
  }),
}));

describe('suggestionPipeline - suggest()', () => {
  let suggest: typeof import('../suggestionPipeline').suggest;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const module = await import('../suggestionPipeline');
    suggest = module.suggest;
  });

  describe('non-Tauri mode', () => {
    it('returns ai strategy with empty suggestions for empty title', async () => {
      const result = await suggest({ taskTitle: '', projectId: 1 });

      expect(result.result).toEqual({ source: 'none', suggestions: [] });
      expect(result.strategy).toBe('ai');
      expect(result.keywords).toEqual([]);
    });

    it('returns ai strategy when no keywords extracted', async () => {
      const result = await suggest({ taskTitle: '!!!', projectId: 1 });

      expect(result.result).toEqual({ source: 'none', suggestions: [] });
      expect(result.strategy).toBe('ai');
      expect(result.keywords).toEqual([]);
    });
  });
});

describe('suggestionPipeline - suggest() (Tauri mode)', () => {
  let suggest: typeof import('../suggestionPipeline').suggest;
  let matchPatterns: ReturnType<typeof vi.fn>;
  let suggestFromLearning: ReturnType<typeof vi.fn>;
  let computeConfidence: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.resetModules();

    const pipelineModule = await import('../suggestionPipeline');
    const patternModule = await import('../patternMatcher');
    const learningModule = await import('../learningEngine');
    const confidenceModule = await import('../confidenceScorer');

    suggest = pipelineModule.suggest;
    matchPatterns = (patternModule.matchPatterns as ReturnType<typeof vi.fn>);
    suggestFromLearning = (learningModule.suggestFromLearning as ReturnType<typeof vi.fn>);
    computeConfidence = (confidenceModule.computeConfidence as ReturnType<typeof vi.fn>);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it('returns local strategy when pattern matches and confidence is high', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.8,
      strategy: 'local',
      hasPatternMatch: true,
    });
    matchPatterns.mockResolvedValue({
      pattern: { id: 1, name: '开发模式', subtasks: ['需求', '设计', '编码'] },
      subtasks: ['需求', '设计', '编码'],
    });

    const result = await suggest({ taskTitle: '开发项目', projectId: 1 });

    expect(result.strategy).toBe('local');
    expect(result.result.source).toBe('pattern');
    expect(result.result.suggestions).toEqual(['需求', '设计', '编码']);
    expect(result.result.patternName).toBe('开发模式');
  });

  it('returns learning suggestions when pattern does not match', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.5,
      strategy: 'hybrid',
      hasPatternMatch: false,
    });
    matchPatterns.mockResolvedValue(null);
    suggestFromLearning.mockResolvedValue({
      suggestions: ['学习任务1', '学习任务2'],
      raw: [],
    });

    const result = await suggest({ taskTitle: '学习', projectId: 1 });

    expect(result.strategy).toBe('hybrid');
    expect(result.result.source).toBe('learning');
    expect(result.result.suggestions).toEqual(['学习任务1', '学习任务2']);
  });

  it('returns hybrid strategy when local suggestions exist but confidence is medium', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.5,
      strategy: 'hybrid',
      hasPatternMatch: false,
    });
    matchPatterns.mockResolvedValue(null);
    suggestFromLearning.mockResolvedValue({
      suggestions: ['本地建议'],
      raw: [],
    });

    const result = await suggest({ taskTitle: '任务', projectId: 1 });

    expect(result.strategy).toBe('hybrid');
    expect(result.result.suggestions).toEqual(['本地建议']);
  });

  it('returns ai strategy when no local suggestions and confidence is low', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.2,
      strategy: 'ai',
      hasPatternMatch: false,
    });
    matchPatterns.mockResolvedValue(null);
    suggestFromLearning.mockResolvedValue(null);

    const result = await suggest({ taskTitle: '新任务', projectId: 1 });

    expect(result.strategy).toBe('ai');
    expect(result.result.source).toBe('none');
    expect(result.result.suggestions).toEqual([]);
  });

  it('downgrades to hybrid when confidence is local but no suggestions', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.8,
      strategy: 'local',
      hasPatternMatch: false,
    });
    matchPatterns.mockResolvedValue(null);
    suggestFromLearning.mockResolvedValue(null);

    const result = await suggest({ taskTitle: '任务', projectId: 1 });

    expect(result.strategy).toBe('hybrid');
    expect(result.result.suggestions).toEqual([]);
  });

  it('returns hybrid when local suggestions exist and confidence is ai', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.2,
      strategy: 'ai',
      hasPatternMatch: false,
    });
    suggestFromLearning.mockResolvedValue({
      suggestions: ['本地建议'],
      raw: [],
    });

    const result = await suggest({ taskTitle: '任务', projectId: 1 });

    expect(result.strategy).toBe('hybrid');
    expect(result.result.suggestions).toEqual(['本地建议']);
  });

  it('handles null projectId', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.8,
      strategy: 'local',
      hasPatternMatch: true,
    });
    matchPatterns.mockResolvedValue({
      pattern: { id: 1, name: 'Test', subtasks: ['a'] },
      subtasks: ['a'],
    });

    const result = await suggest({ taskTitle: '任务', projectId: null });

    expect(computeConfidence).toHaveBeenCalledWith(expect.any(Array), null);
    expect(result.strategy).toBe('local');
  });

  // Strategy routing matrix tests
  it('local + pattern → local', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.8,
      strategy: 'local',
      hasPatternMatch: true,
    });
    matchPatterns.mockResolvedValue({
      pattern: { id: 1, name: 'Test', subtasks: ['a'] },
      subtasks: ['a'],
    });

    const result = await suggest({ taskTitle: '任务', projectId: 1 });
    expect(result.strategy).toBe('local');
  });

  it('pattern + hybrid → hybrid', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.5,
      strategy: 'hybrid',
      hasPatternMatch: true,
    });
    matchPatterns.mockResolvedValue({
      pattern: { id: 1, name: 'Test', subtasks: ['a'] },
      subtasks: ['a'],
    });

    const result = await suggest({ taskTitle: '任务', projectId: 1 });
    expect(result.strategy).toBe('hybrid');
  });

  it('pattern + ai → hybrid (upgrade)', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.2,
      strategy: 'ai',
      hasPatternMatch: true,
    });
    matchPatterns.mockResolvedValue({
      pattern: { id: 1, name: 'Test', subtasks: ['a'] },
      subtasks: ['a'],
    });

    const result = await suggest({ taskTitle: '任务', projectId: 1 });
    expect(result.strategy).toBe('hybrid');
  });

  it('no pattern + local confidence → hybrid', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.8,
      strategy: 'local',
      hasPatternMatch: false,
    });
    matchPatterns.mockResolvedValue(null);
    suggestFromLearning.mockResolvedValue(null);

    const result = await suggest({ taskTitle: '任务', projectId: 1 });
    expect(result.strategy).toBe('hybrid');
  });

  it('no pattern + hybrid → hybrid', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.5,
      strategy: 'hybrid',
      hasPatternMatch: false,
    });
    matchPatterns.mockResolvedValue(null);
    suggestFromLearning.mockResolvedValue(null);

    const result = await suggest({ taskTitle: '任务', projectId: 1 });
    expect(result.strategy).toBe('hybrid');
  });

  it('no pattern + ai → ai', async () => {
    computeConfidence.mockResolvedValue({
      score: 0.2,
      strategy: 'ai',
      hasPatternMatch: false,
    });
    matchPatterns.mockResolvedValue(null);
    suggestFromLearning.mockResolvedValue(null);

    const result = await suggest({ taskTitle: '任务', projectId: 1 });
    expect(result.strategy).toBe('ai');
  });
});

describe('suggestionPipeline - buildAiContext()', () => {
  let buildAiContext: typeof import('../suggestionPipeline').buildAiContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.resetModules();

    const module = await import('../suggestionPipeline');
    buildAiContext = module.buildAiContext;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it('returns empty strings for non-Tauri mode', async () => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();

    const module = await import('../suggestionPipeline');
    buildAiContext = module.buildAiContext;

    const result = await buildAiContext({ taskTitle: '任务', projectId: 1 });

    expect(result).toEqual({
      userPatterns: '',
      learnedItems: '',
      rejectedItems: '',
      manualSubtasks: '',
      siblingTasks: '',
    });
  });

  it('returns empty strings for empty keywords', async () => {
    const result = await buildAiContext({ taskTitle: '!!!', projectId: 1 });

    expect(result).toEqual({
      userPatterns: '',
      learnedItems: '',
      rejectedItems: '',
      manualSubtasks: '',
      siblingTasks: '',
    });
  });

  it('fetches all 4 context sources in parallel', async () => {
    const { matchPatterns } = await import('../patternMatcher');
    const { suggestFromLearning } = await import('../learningEngine');
    const { feedbackRejectedTitles } = await import('../../commands/learning');
    const { historySuggest } = await import('../../commands/learning');

    (matchPatterns as ReturnType<typeof vi.fn>).mockResolvedValue({
      pattern: { id: 1, name: 'Pattern', subtasks: ['p1', 'p2'] },
      subtasks: ['p1', 'p2'],
    });
    (suggestFromLearning as ReturnType<typeof vi.fn>).mockResolvedValue({
      suggestions: ['l1', 'l2'],
      raw: [],
    });
    (feedbackRejectedTitles as ReturnType<typeof vi.fn>).mockResolvedValue(['r1']);
    (historySuggest as ReturnType<typeof vi.fn>).mockResolvedValue(['h1', 'h2']);

    const result = await buildAiContext({ taskTitle: '任务', projectId: 1 });

    expect(result.userPatterns).toBe('p1, p2');
    expect(result.learnedItems).toBe('l1, l2');
    expect(result.rejectedItems).toBe('r1');
    expect(result.manualSubtasks).toBe('h1, h2');
    expect(result.siblingTasks).toBe('');
  });

  it('handles null pattern result', async () => {
    const { matchPatterns } = await import('../patternMatcher');
    const { suggestFromLearning } = await import('../learningEngine');
    const { feedbackRejectedTitles } = await import('../../commands/learning');
    const { historySuggest } = await import('../../commands/learning');

    (matchPatterns as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (suggestFromLearning as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (feedbackRejectedTitles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (historySuggest as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await buildAiContext({ taskTitle: '任务', projectId: 1 });

    expect(result.userPatterns).toBe('');
    expect(result.learnedItems).toBe('');
    expect(result.rejectedItems).toBe('');
    expect(result.manualSubtasks).toBe('');
  });

  it('handles DB errors gracefully', async () => {
    const { matchPatterns } = await import('../patternMatcher');
    const { suggestFromLearning } = await import('../learningEngine');
    const { feedbackRejectedTitles } = await import('../../commands/learning');
    const { historySuggest } = await import('../../commands/learning');

    (matchPatterns as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));
    (suggestFromLearning as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));
    (feedbackRejectedTitles as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));
    (historySuggest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

    const result = await buildAiContext({ taskTitle: '任务', projectId: 1 });

    expect(result.userPatterns).toBe('');
    expect(result.learnedItems).toBe('');
    expect(result.rejectedItems).toBe('');
    expect(result.manualSubtasks).toBe('');
  });

  it('passes keywords and projectId to all queries', async () => {
    const { matchPatterns } = await import('../patternMatcher');
    const { suggestFromLearning } = await import('../learningEngine');
    const { feedbackRejectedTitles } = await import('../../commands/learning');
    const { historySuggest } = await import('../../commands/learning');

    (matchPatterns as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (suggestFromLearning as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (feedbackRejectedTitles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (historySuggest as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await buildAiContext({ taskTitle: '开发项目', projectId: 123 });

    expect((matchPatterns as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toBe(123);
    expect((suggestFromLearning as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toBe(123);
    expect((feedbackRejectedTitles as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toBe(123);
    expect((historySuggest as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toBe(123);
  });

  it('handles null projectId', async () => {
    const { matchPatterns } = await import('../patternMatcher');

    (matchPatterns as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (await import('../learningEngine')).suggestFromLearning.mockResolvedValue(null);
    (await import('../../commands/learning')).feedbackRejectedTitles.mockResolvedValue([]);
    (await import('../../commands/learning')).historySuggest.mockResolvedValue([]);

    await buildAiContext({ taskTitle: '任务', projectId: null });

    expect((matchPatterns as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toBe(null);
  });

  it('siblingTasks is always empty (TODO)', async () => {
    (await import('../patternMatcher')).matchPatterns.mockResolvedValue(null);
    (await import('../learningEngine')).suggestFromLearning.mockResolvedValue(null);
    (await import('../../commands/learning')).feedbackRejectedTitles.mockResolvedValue([]);
    (await import('../../commands/learning')).historySuggest.mockResolvedValue([]);

    const result = await buildAiContext({ taskTitle: '任务', projectId: 1 });

    expect(result.siblingTasks).toBe('');
  });
});
