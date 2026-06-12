/**
 * Candidate ranker — scores and ranks merged candidates.
 *
 * v2 of the Suggestion Harness ranking stage.
 *
 * Scoring signals:
 *   + source weights           (Σ per-source weight: history 0.5 > pattern 0.45
 *                               > learning 0.35 > ai_generated 0.3 > sibling 0.2)
 *   + multi-source agreement   (+0.25 per extra distinct source)
 *   + learn-log score          (saturating: 0.6 * rawScore / (rawScore + 3))
 *   + keyword overlap          (0.3 * min(matched, 3) / 3)
 *   + children bonus           (+0.15 when a history template carries children)
 *   - duplicate penalty        (-1.2 on semantic match with an existing subtask)
 *   - rejection penalty        (-0.8 on normalized/semantic match with a rejected title)
 *   - self-echo penalty        (-0.6 when the candidate echoes the task title itself)
 *   - generic/vague penalty    (-0.2 if title < 2 chars)
 *
 * Final order applies MMR diversity reordering (λ = 0.35, charJaccard over
 * normalized titles) — near-duplicates are demoted, nothing is dropped, and
 * the score field keeps its pre-MMR value.
 */
import type { TitleAnalysis, SuggestionCandidate, RankedSuggestion } from '../../types/domain';
import { isSemanticDuplicateTitle, normalizeSubtaskTitle } from '../ai/subtaskDedup';
import { charJaccard } from './keywordExtractor';

export interface RankingContext {
  projectId: number | null;
  existingSubtaskTitles: Set<string>;
  /** Parent task title — used to penalize suggestions echoing the task itself. */
  taskTitle?: string;
}

// Per-source confidence weights (manual history is the strongest signal)
const SOURCE_WEIGHTS: Record<string, number> = {
  history: 0.5,
  pattern: 0.45,
  learning: 0.35,
  sibling: 0.2,
  ai_generated: 0.3,
};

/** Smooth saturation — monotonic, 0 at 0, approaches 1 asymptotically. */
const sat = (x: number, k: number): number => (x <= 0 ? 0 : x / (x + k));

// MMR diversity trade-off (0 = pure relevance, higher = more diversity)
const MMR_LAMBDA = 0.35;

export function rankCandidates(
  candidates: SuggestionCandidate[],
  analysis: TitleAnalysis,
  ctx: RankingContext,
  rejectedTitles: string[],
): RankedSuggestion[] {
  const keywordSet = new Set(analysis.keywords.map(k => k.toLowerCase()));
  const rejectedNormalized = rejectedTitles.map(t => normalizeSubtaskTitle(t));

  const scored = candidates.map(c => {
    const reasons: string[] = [];
    let score = 0;

    // + Source weights (merger already dedupes sources)
    const distinctSources = [...new Set(c.sources)];
    for (const s of distinctSources) {
      score += SOURCE_WEIGHTS[s] ?? 0;
    }
    reasons.push(`sources: ${distinctSources.join('+')}`);

    // + Multi-source agreement — independent retrievers agreeing compounds
    if (distinctSources.length >= 2) {
      score += 0.25 * (distinctSources.length - 1);
      reasons.push('multi_source_agreement');
    }

    // + Learn-log score (saturating — high raw scores stop dominating)
    if (c.rawScore !== undefined && c.rawScore > 0) {
      score += 0.6 * sat(c.rawScore, 3);
      reasons.push(`learn_score: ${c.rawScore}`);
    }

    // + Keyword overlap with title
    const titleLower = c.title.toLowerCase();
    let matched = 0;
    for (const kw of keywordSet) {
      if (titleLower.includes(kw) || kw.includes(titleLower)) {
        matched++;
      }
    }
    if (matched > 0) {
      score += 0.3 * (Math.min(matched, 3) / 3);
      reasons.push(`keyword_overlap: ${matched}`);
    }

    // + Children bonus — history templates that bring a subtree are richer
    if (c.children?.length) {
      score += 0.15;
      reasons.push('has_children');
    }

    // - Duplicate penalty (semantic match against existing subtasks)
    let isDuplicate = false;
    for (const existing of ctx.existingSubtaskTitles) {
      if (isSemanticDuplicateTitle(existing, c.title)) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) {
      score -= 1.2;
      reasons.push('duplicate_existing_subtask');
    }

    // - Rejection penalty (normalized or semantic match)
    const normalizedTitle = normalizeSubtaskTitle(c.title);
    const isRejected = rejectedTitles.some((r, i) =>
      rejectedNormalized[i] === normalizedTitle || isSemanticDuplicateTitle(r, c.title));
    if (isRejected) {
      score -= 0.8;
      reasons.push('previously_rejected');
    }

    // - Self-echo penalty (suggesting the task itself back)
    if (ctx.taskTitle && isSemanticDuplicateTitle(c.title, ctx.taskTitle)) {
      score -= 0.6;
      reasons.push('self_echo');
    }

    // - Generic/vague penalty
    if (c.title.trim().length < 2) {
      score -= 0.2;
      reasons.push('too_short');
    }

    return {
      title: c.title,
      score,
      sources: c.sources,
      evidence: c.evidence,
      reasons,
      children: c.children,
    } satisfies RankedSuggestion;
  });

  // Sort by score descending (stable — merger order breaks ties)
  scored.sort((a, b) => b.score - a.score);

  // ── MMR diversity reorder — demote near-duplicates, drop nothing ──

  const pool = scored.map(s => ({ item: s, normalized: normalizeSubtaskTitle(s.title) }));
  const selected: RankedSuggestion[] = [];
  const selectedNormalized: string[] = [];

  while (pool.length > 0) {
    let bestIdx = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      let maxSim = 0;
      for (const sel of selectedNormalized) {
        const sim = charJaccard(pool[i].normalized, sel);
        if (sim > maxSim) maxSim = sim;
      }
      const value = pool[i].item.score - MMR_LAMBDA * maxSim;
      // Strict > keeps the earliest pool item on ties
      if (value > bestValue) {
        bestValue = value;
        bestIdx = i;
      }
    }
    const [picked] = pool.splice(bestIdx, 1);
    selected.push(picked.item);
    selectedNormalized.push(picked.normalized);
  }

  return selected;
}
