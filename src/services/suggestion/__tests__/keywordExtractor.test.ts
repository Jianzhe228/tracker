/**
 * Tests for keywordExtractor module (C4 — scored ranking + fragment suppression).
 *
 * Runs against the real Intl.Segmenter (available in Node >= 18), so these
 * tests pin actual segmentation-dependent behavior. Temporal words (下午/四点)
 * are filtered by design — they must never become keywords.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../keywordCache', () => ({
  getKnownKeywords: vi.fn(() => new Set<string>()),
}));

import { extractKeywords, extractKeywordsScored } from '../keywordExtractor';
import { getKnownKeywords } from '../keywordCache';

describe('keywordExtractor (C4)', () => {
  beforeEach(() => {
    vi.mocked(getKnownKeywords).mockReturnValue(new Set<string>());
  });

  describe('extraction basics', () => {
    it('returns empty for blank titles', () => {
      expect(extractKeywords('')).toEqual([]);
      expect(extractKeywords('   ')).toEqual([]);
    });

    it('extracts compound entities and filters temporal noise', () => {
      const kws = extractKeywords('下午四点去菜市场买菜');
      expect(kws).toContain('菜市场');
      expect(kws).toContain('买菜');
      expect(kws).not.toContain('下午');
      expect(kws).not.toContain('四点');
    });

    it('recovers boundary-merged compounds (开题+报告 → 开题报告)', () => {
      const kws = extractKeywords('写毕业论文开题报告');
      expect(kws).toContain('毕业论文');
      expect(kws).toContain('开题报告');
    });

    it('keeps lowercased english tokens alongside chinese keywords', () => {
      const kws = extractKeywords('修复登录页面的Bug');
      expect(kws).toContain('bug');
      expect(kws.some(kw => kw.includes('登录'))).toBe(true);
    });

    it('extracts mixed chinese/english tech terms', () => {
      const kws = extractKeywords('学习Vue3组合式API');
      expect(kws).toContain('vue3');
      expect(kws).toContain('api');
    });
  });

  describe('fragment suppression', () => {
    it('drops run bigrams covered by a kept boundary merge (高数 ⊂ 高数第一章)', () => {
      const kws = extractKeywords('复习高数第一章');
      expect(kws).toContain('高数第一章');
      expect(kws).not.toContain('高数');
    });

    it('never emits a run fragment together with its kept container', () => {
      const kws = extractKeywords('下午四点去菜市场买菜');
      expect(kws).toContain('菜市场');
      // The run fragment 菜市 must not coexist with the kept merge 菜市场.
      // (市场 is a segmenter content word here — only 'run' n-grams are
      // subject to suppression, so it legitimately survives.)
      expect(kws).not.toContain('菜市');
      expect(kws.includes('菜市') && kws.includes('菜市场')).toBe(false);
    });
  });

  describe('scored ordering', () => {
    it('ranks content/merge candidates above raw run bigrams', () => {
      const kws = extractKeywords('修复登录页面的Bug');
      // 页面 is a recovered run bigram — the weakest origin
      expect(kws.indexOf('修复')).toBeLessThan(kws.indexOf('页面'));
      expect(kws.indexOf('登录')).toBeLessThan(kws.indexOf('页面'));
    });

    it('ranks pure-digit tokens behind real words', () => {
      const kws = extractKeywords('跑步30分钟');
      expect(kws.indexOf('跑步')).toBeLessThan(kws.indexOf('30'));
    });
  });

  describe('known-keyword boost', () => {
    it('lifts known keywords above previously stronger unknowns', () => {
      const before = extractKeywords('修复登录页面的Bug');
      expect(before.indexOf('页面')).toBeGreaterThan(before.indexOf('修复'));

      vi.mocked(getKnownKeywords).mockReturnValue(new Set(['页面']));
      const after = extractKeywords('修复登录页面的Bug');
      expect(after.indexOf('页面')).toBeLessThan(after.indexOf('修复'));
    });
  });

  describe('extractKeywordsScored', () => {
    it('exposes scores and origins consistent with extractKeywords', () => {
      const title = '学习Vue3组合式API';
      const scored = extractKeywordsScored(title);
      expect(scored.length).toBeGreaterThan(0);
      expect(extractKeywords(title)).toEqual(scored.map(k => k.text));
      for (const k of scored) {
        expect(k.score).toBeGreaterThan(0);
        expect(['content', 'join', 'merge', 'run', 'english']).toContain(k.origin);
      }
    });
  });

  describe('cap and dedupe', () => {
    it('caps results at 12 and never repeats a keyword', () => {
      const kws = extractKeywords('优化首页加载速度并重构订单模块代码以及修复登录页面问题和整理项目文档资料');
      expect(kws.length).toBeLessThanOrEqual(12);
      expect(new Set(kws).size).toBe(kws.length);
    });
  });
});
