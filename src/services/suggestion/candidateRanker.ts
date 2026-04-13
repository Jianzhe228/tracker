/**
 * Candidate ranker — scores and ranks merged candidates.
 *
 * Phase 1 of the Suggestion Harness design.
 *
 * Scoring signals:
 *   + learn-log score         (rawScore * 0.3)
 *   + history frequency       (count of sources * 0.15)
 *   + keyword overlap         (keywords in title * 0.1)
 *   + project match           (0.1 if source includes 'pattern' with project match)
 *   - duplicate penalty       (-1.0 if title exists in existingSubtaskTitles)
 *   - rejection penalty       (-0.5 if title matches a rejected title)
 *   - generic/vague penalty   (-0.2 if title < 2 chars)
 */
import type { TitleAnalysis, SuggestionCandidate, RankedSuggestion } from '../../types/domain';

export interface RankingContext {
  projectId: number | null;
  existingSubtaskTitles: Set<string>;
}

export function rankCandidates(
  candidates: SuggestionCandidate[],
  analysis: TitleAnalysis,
  ctx: RankingContext,
  rejectedTitles: string[],
): RankedSuggestion[] {
  const rejectedSet = new Set(rejectedTitles.map(t => t.toLowerCase()));
  const keywordSet = new Set(analysis.keywords.map(k => k.toLowerCase()));
  // Build a lowercase set for case-insensitive duplicate detection
  const existingSubtaskLower = new Set(
    [...ctx.existingSubtaskTitles].map(t => t.toLowerCase()),
  );

  const scored = candidates.map(c => {
    const reasons: string[] = [];
    let score = 0;

    // + Learn-log score
    if (c.rawScore !== undefined && c.rawScore > 0) {
      score += c.rawScore * 0.3;
      reasons.push(`learn_score: ${c.rawScore}`);
    }

    // + History frequency (number of sources — more sources = more confident signal)
    const sourceCount = c.sources.length;
    score += sourceCount * 0.15;
    reasons.push(`source_count: ${sourceCount}`);

    // + Keyword overlap with title
    const titleLower = c.title.toLowerCase();
    let kwOverlap = 0;
    for (const kw of keywordSet) {
      if (titleLower.includes(kw) || kw.includes(titleLower)) {
        kwOverlap++;
      }
    }
    if (kwOverlap > 0) {
      score += kwOverlap * 0.1;
      reasons.push(`keyword_overlap: ${kwOverlap}`);
    }

    // - Duplicate penalty
    if (existingSubtaskLower.has(titleLower)) {
      score -= 1.0;
      reasons.push('duplicate_existing_subtask');
    }

    // - Rejection penalty
    if (rejectedSet.has(titleLower)) {
      score -= 0.5;
      reasons.push('previously_rejected');
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

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}
