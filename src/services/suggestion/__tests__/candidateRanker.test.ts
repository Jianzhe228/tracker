/**
 * Tests for candidateRanker module (v2 — source weights + agreement +
 * semantic dedup + MMR diversity reorder).
 */
import { describe, it, expect } from 'vitest';
import type { SuggestionCandidate, TitleAnalysis } from '../../../types/domain';
import { rankCandidates } from '../candidateRanker';

// ── Helpers ────────────────────────────────────────────────────────

function makeAnalysis(keywords: string[] = []): TitleAnalysis {
  return {
    rawTitle: '',
    normalizedTitle: '',
    keywords,
    intentHints: [],
    entityHints: [],
    timeHints: [],
    englishTerms: [],
    segmentTrace: [],
  };
}

function makeCandidate(
  overrides: Partial<SuggestionCandidate> & { title: string },
): SuggestionCandidate {
  return { sources: ['history'], evidence: [], ...overrides };
}

function makeCtx(overrides: Partial<{ taskTitle: string; existing: string[] }> = {}) {
  return {
    projectId: null,
    existingSubtaskTitles: new Set(overrides.existing ?? []),
    taskTitle: overrides.taskTitle,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('candidateRanker (v2)', () => {
  it('ranks multi-source agreement above a single source with equal other signals', () => {
    const ranked = rankCandidates(
      [
        makeCandidate({ title: '准备会议材料', sources: ['history'] }),
        makeCandidate({ title: '整理需求列表', sources: ['history', 'pattern'] }),
      ],
      makeAnalysis(),
      makeCtx(),
      [],
    );

    expect(ranked[0].title).toBe('整理需求列表');
    expect(ranked[0].reasons).toContain('multi_source_agreement');
    // history 0.5 + pattern 0.45 + agreement 0.25
    expect(ranked[0].score).toBeCloseTo(1.2, 5);
    expect(ranked[1].reasons).not.toContain('multi_source_agreement');
  });

  it('weights history source above sibling source', () => {
    const ranked = rankCandidates(
      [
        makeCandidate({ title: '写阅读笔记', sources: ['sibling'] }),
        makeCandidate({ title: '背英语单词', sources: ['history'] }),
      ],
      makeAnalysis(),
      makeCtx(),
      [],
    );

    expect(ranked[0].title).toBe('背英语单词');
    expect(ranked[0].score).toBeCloseTo(0.5, 5);
    expect(ranked[1].score).toBeCloseTo(0.2, 5);
  });

  it('penalizes semantic duplicates of existing subtasks (fuzzy match)', () => {
    const ranked = rankCandidates(
      [makeCandidate({ title: '整理数据', sources: ['history'] })],
      makeAnalysis(),
      makeCtx({ existing: ['整理 数据'] }),
      [],
    );

    expect(ranked[0].reasons).toContain('duplicate_existing_subtask');
    // history 0.5 − duplicate 1.2
    expect(ranked[0].score).toBeCloseTo(-0.7, 5);
  });

  it('penalizes previously rejected titles via normalized match', () => {
    const ranked = rankCandidates(
      [makeCandidate({ title: '整理数据', sources: ['history'] })],
      makeAnalysis(),
      makeCtx(),
      ['整理（数据）'],
    );

    expect(ranked[0].reasons).toContain('previously_rejected');
    // history 0.5 − rejected 0.8
    expect(ranked[0].score).toBeCloseTo(-0.3, 5);
  });

  it('penalizes candidates that echo the task title back (self echo)', () => {
    const ranked = rankCandidates(
      [
        makeCandidate({ title: '复习高数', sources: ['learning'] }),
        makeCandidate({ title: '整理错题', sources: ['learning'] }),
      ],
      makeAnalysis(),
      makeCtx({ taskTitle: '复习 高数' }),
      [],
    );

    const echo = ranked.find(r => r.title === '复习高数')!;
    const other = ranked.find(r => r.title === '整理错题')!;
    expect(echo.reasons).toContain('self_echo');
    // learning 0.35 − self echo 0.6
    expect(echo.score).toBeCloseTo(-0.25, 5);
    expect(other.reasons).not.toContain('self_echo');
  });

  it('saturates learn scores so high raw scores stop dominating', () => {
    const ranked = rankCandidates(
      [
        makeCandidate({ title: '打印准考证', sources: ['learning'], rawScore: 30 }),
        makeCandidate({ title: '预约考试场地', sources: ['learning'], rawScore: 5 }),
      ],
      makeAnalysis(),
      makeCtx(),
      [],
    );

    const high = ranked.find(r => r.title === '打印准考证')!;
    const low = ranked.find(r => r.title === '预约考试场地')!;
    expect(high.reasons).toContain('learn_score: 30');
    expect(low.reasons).toContain('learn_score: 5');
    // Both learn contributions stay below the 0.6 cap (old formula: a 7.5 gap)
    expect(high.score - 0.35).toBeLessThan(0.6);
    expect(low.score - 0.35).toBeLessThan(0.6);
    // 0.6*(30/33 − 5/8) ≈ 0.17 — a narrow, saturated gap
    expect(high.score).toBeGreaterThan(low.score);
    expect(high.score - low.score).toBeLessThan(0.18);
  });

  it('reorders near-duplicate candidates for diversity (MMR)', () => {
    const ranked = rankCandidates(
      [
        makeCandidate({ title: '复习高数第一章', sources: ['history', 'pattern'] }), // 1.2
        makeCandidate({ title: '复习高数第1章', sources: ['history'] }),             // 0.5
        makeCandidate({ title: '整理错题笔记', sources: ['pattern'] }),              // 0.45
      ],
      makeAnalysis(),
      makeCtx(),
      [],
    );

    // 复习高数第1章 is near-identical to the top pick (charJaccard 0.75) —
    // MMR demotes it below the dissimilar 整理错题笔记 despite its higher score
    expect(ranked.map(r => r.title)).toEqual([
      '复习高数第一章',
      '整理错题笔记',
      '复习高数第1章',
    ]);
    // Scores keep their pre-MMR values — only the order is diversity-adjusted
    expect(ranked[1].score).toBeCloseTo(0.45, 5);
    expect(ranked[2].score).toBeCloseTo(0.5, 5);
  });

  it('rewards keyword overlap and children, keeping reason strings', () => {
    const ranked = rankCandidates(
      [
        makeCandidate({
          title: '写三篇阅读理解',
          sources: ['history'],
          children: [{ title: '精读一篇', children: [] }],
        }),
      ],
      makeAnalysis(['阅读', '理解']),
      makeCtx(),
      [],
    );

    expect(ranked[0].reasons).toContain('keyword_overlap: 2');
    expect(ranked[0].reasons).toContain('has_children');
    expect(ranked[0].reasons).toContain('sources: history');
    // history 0.5 + overlap 0.3*(2/3) + children 0.15
    expect(ranked[0].score).toBeCloseTo(0.85, 5);
  });
});
