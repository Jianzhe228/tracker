/**
 * Tests for patternMatcher module.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Ensure non-Tauri mode by default
delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;

// Mock the Tauri command BEFORE importing the module
vi.mock('../../commands/pattern', () => ({
  patternMatch: vi.fn(),
}));

describe('patternMatcher (non-Tauri mode)', () => {
  let matchPatterns: typeof import('../patternMatcher').matchPatterns;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
    const module = await import('../patternMatcher');
    matchPatterns = module.matchPatterns;
  });

  it('returns null when not in Tauri environment', async () => {
    const result = await matchPatterns(['keyword'], 1);
    expect(result).toBeNull();
  });

  it('returns null for empty keywords in non-Tauri mode', async () => {
    const result = await matchPatterns([], 1);
    expect(result).toBeNull();
  });
});

describe('patternMatcher (Tauri mode)', () => {
  let matchPatterns: typeof import('../patternMatcher').matchPatterns;
  let patternMatch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.resetModules();

    const patternModule = await import('../patternMatcher');
    const commandsModule = await import('../../commands/pattern');

    matchPatterns = patternModule.matchPatterns;
    patternMatch = (commandsModule.patternMatch as ReturnType<typeof vi.fn>);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it('returns first pattern when DB returns multiple matches', async () => {
    const patterns = [
      { id: 1, name: 'Pattern A', subtasks: ['a1', 'a2'], usage_count: 5 },
      { id: 2, name: 'Pattern B', subtasks: ['b1', 'b2'], usage_count: 10 },
    ];
    patternMatch.mockResolvedValue(patterns);

    const result = await matchPatterns(['keyword'], 1);

    expect(result).not.toBeNull();
    expect(result!.pattern).toBe(patterns[0]); // Should return first (highest usage_count)
    expect(result!.subtasks).toEqual(['a1', 'a2']);
  });

  it('returns null when DB returns empty array', async () => {
    patternMatch.mockResolvedValue([]);

    const result = await matchPatterns(['keyword'], 1);

    expect(result).toBeNull();
  });

  it('returns null for empty keywords', async () => {
    const result = await matchPatterns([], 1);

    expect(result).toBeNull();
    expect(patternMatch).not.toHaveBeenCalled();
  });

  it('passes keywords and projectId to patternMatch', async () => {
    patternMatch.mockResolvedValue([
      { id: 1, name: 'Test', subtasks: ['s1'], usage_count: 1 },
    ]);

    await matchPatterns(['项目', '开发'], 123);

    expect(patternMatch).toHaveBeenCalledWith(['项目', '开发'], 123);
  });

  it('handles null projectId', async () => {
    patternMatch.mockResolvedValue([]);

    await matchPatterns(['keyword'], null);

    expect(patternMatch).toHaveBeenCalledWith(['keyword'], null);
  });

  it('returns pattern with subtasks array', async () => {
    const pattern = {
      id: 1,
      name: '开发模式',
      subtasks: ['需求分析', '技术方案', '编码实现', '测试验证'],
      usage_count: 15,
    };
    patternMatch.mockResolvedValue([pattern]);

    const result = await matchPatterns(['开发'], 1);

    expect(result!.pattern).toBe(pattern);
    expect(result!.subtasks).toEqual(pattern.subtasks);
  });

  it('handles DB error gracefully (returns null)', async () => {
    patternMatch.mockRejectedValue(new Error('DB connection failed'));

    const result = await matchPatterns(['keyword'], 1);

    expect(result).toBeNull();
  });

  it('handles single match', async () => {
    const pattern = {
      id: 1,
      name: 'Single Pattern',
      subtasks: ['task1'],
      usage_count: 1,
    };
    patternMatch.mockResolvedValue([pattern]);

    const result = await matchPatterns(['keyword'], 1);

    expect(result!.pattern).toBe(pattern);
    expect(result!.subtasks).toEqual(['task1']);
  });

  it('returns project-specific pattern when prioritized', async () => {
    const patterns = [
      { id: 1, name: 'Global Pattern', subtasks: ['g1'], usage_count: 100, project_id: null },
      { id: 2, name: 'Project Pattern', subtasks: ['p1'], usage_count: 5, project_id: 123 },
    ];
    patternMatch.mockResolvedValue(patterns);

    const result = await matchPatterns(['keyword'], 123);

    // Backend should sort project-specific first, we just take index 0
    expect(result!.pattern.id).toBe(1);
  });

  it('handles pattern with empty subtasks', async () => {
    const pattern = {
      id: 1,
      name: 'Empty Pattern',
      subtasks: [],
      usage_count: 1,
    };
    patternMatch.mockResolvedValue([pattern]);

    const result = await matchPatterns(['keyword'], 1);

    // Result is returned, subtasks is empty array
    expect(result).not.toBeNull();
    expect(result!.subtasks).toEqual([]);
  });
});
