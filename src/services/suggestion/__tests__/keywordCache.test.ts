/**
 * Tests for keywordCache module.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { refreshKnownKeywords, isKnownKeyword, getKnownKeywords, isLoaded } from '../keywordCache';
import { learnKnownKeywords } from '../../commands/learning';

// Mock the Tauri command
vi.mock('../../commands/learning', () => ({
  learnKnownKeywords: vi.fn(),
}));

// Ensure non-Tauri mode by default
delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;

describe('keywordCache (non-Tauri mode)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
    await import('../keywordCache');
  });

  it('refreshKnownKeywords does nothing in non-Tauri mode', async () => {
    const { learnKnownKeywords } = await import('../../commands/learning');
    await refreshKnownKeywords();

    expect(learnKnownKeywords).not.toHaveBeenCalled();
    expect(isLoaded()).toBe(false);
    expect(getKnownKeywords().size).toBe(0);
  });

  it('isKnownKeyword returns false in non-Tauri mode', () => {
    expect(isKnownKeyword('anything')).toBe(false);
  });

  it('getKnownKeywords returns empty Set in non-Tauri mode', () => {
    expect(getKnownKeywords().size).toBe(0);
  });

  it('isLoaded returns false in non-Tauri mode', () => {
    expect(isLoaded()).toBe(false);
  });
});

describe('keywordCache (Tauri mode)', () => {
  let learnKnownKeywordsMock: ReturnType<typeof vi.fn>;
  let refreshKnownKeywordsFn: typeof refreshKnownKeywords;
  let isKnownKeywordFn: typeof isKnownKeyword;
  let getKnownKeywordsFn: typeof getKnownKeywords;
  let isLoadedFn: typeof isLoaded;

  beforeEach(async () => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.resetModules();

    // Dynamically import after setting Tauri flag so isTauri=true
    const cacheModule = await import('../keywordCache');
    const commandsModule = await import('../../commands/learning');

    refreshKnownKeywordsFn = cacheModule.refreshKnownKeywords;
    isKnownKeywordFn = cacheModule.isKnownKeyword;
    getKnownKeywordsFn = cacheModule.getKnownKeywords;
    isLoadedFn = cacheModule.isLoaded;
    learnKnownKeywordsMock = (commandsModule.learnKnownKeywords as ReturnType<typeof vi.fn>);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it('refreshKnownKeywords loads keywords from DB', async () => {
    learnKnownKeywordsMock.mockResolvedValue(['项目', '开发', '测试']);

    await refreshKnownKeywordsFn();

    expect(learnKnownKeywordsMock).toHaveBeenCalledTimes(1);
    expect(isLoadedFn()).toBe(true);
    expect(getKnownKeywordsFn().size).toBe(3);
    expect(isKnownKeywordFn('项目')).toBe(true);
    expect(isKnownKeywordFn('开发')).toBe(true);
    expect(isKnownKeywordFn('测试')).toBe(true);
  });

  it('isKnownKeyword returns false for unknown keyword', async () => {
    learnKnownKeywordsMock.mockResolvedValue(['项目']);

    await refreshKnownKeywordsFn();

    expect(isKnownKeywordFn('项目')).toBe(true);
    expect(isKnownKeywordFn('未知')).toBe(false);
  });

  it('getKnownKeywords returns the internal Set reference', async () => {
    const keywords = ['a', 'b', 'c'];
    learnKnownKeywordsMock.mockResolvedValue(keywords);

    await refreshKnownKeywordsFn();

    const result = getKnownKeywordsFn();
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(3);
  });

  it('isLoaded returns false before refresh', () => {
    expect(isLoadedFn()).toBe(false);
  });

  it('isLoaded returns true after successful refresh', async () => {
    learnKnownKeywordsMock.mockResolvedValue(['keyword']);

    await refreshKnownKeywordsFn();

    expect(isLoadedFn()).toBe(true);
  });

  it('handles empty result from DB', async () => {
    learnKnownKeywordsMock.mockResolvedValue([]);

    await refreshKnownKeywordsFn();

    expect(isLoadedFn()).toBe(true);
    expect(getKnownKeywordsFn().size).toBe(0);
  });

  it('handles DB error gracefully (cache remains unchanged)', async () => {
    // First, load some keywords
    learnKnownKeywordsMock.mockResolvedValueOnce(['original']);

    await refreshKnownKeywordsFn();
    expect(getKnownKeywordsFn().size).toBe(1);
    expect(isKnownKeywordFn('original')).toBe(true);

    // Second call fails - cache should remain unchanged
    learnKnownKeywordsMock.mockRejectedValueOnce(new Error('DB error'));

    await refreshKnownKeywordsFn();

    expect(isLoadedFn()).toBe(true); // Still true from first load
    expect(getKnownKeywordsFn().size).toBe(1);
    expect(isKnownKeywordFn('original')).toBe(true);
  });

  it('replaces cache on subsequent refresh (not merge)', async () => {
    learnKnownKeywordsMock
      .mockResolvedValueOnce(['a', 'b'])
      .mockResolvedValueOnce(['x', 'y', 'z']);

    await refreshKnownKeywordsFn();
    expect(getKnownKeywordsFn().size).toBe(2);

    await refreshKnownKeywordsFn();
    expect(getKnownKeywordsFn().size).toBe(3);
    expect(isKnownKeywordFn('a')).toBe(false);
    expect(isKnownKeywordFn('x')).toBe(true);
  });

  it('concurrent refresh calls are safe', async () => {
    let resolveFirst!: (v: string[]) => void;
    const firstPromise = new Promise<string[]>((r) => { resolveFirst = r; });
    const secondPromise = Promise.resolve(['second']);

    learnKnownKeywordsMock
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise);

    // Fire two concurrent refreshes
    const r1 = refreshKnownKeywordsFn();
    const r2 = refreshKnownKeywordsFn();

    // Resolve first, then wait
    resolveFirst(['first']);
    await Promise.all([r1, r2]);

    // Both should complete, cache should have one of the results
    expect(isLoadedFn()).toBe(true);
    const size = getKnownKeywordsFn().size;
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(3);
  });
});
