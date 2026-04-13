/**
 * Candidate merger — deduplicates and merges candidates from multiple retrievers.
 *
 * Phase 1 of the Suggestion Harness design.
 * Uses semantic normalization to identify duplicate titles from different sources,
 * then merges their evidence and sources into a single candidate.
 */
import type { SuggestionCandidate } from '../../types/domain';
import { normalizeSubtaskTitle } from '../ai/subtaskDedup';

/**
 * Deduplicate and merge candidates from all retrievers.
 * Candidates with the same normalized title are merged into one,
 * combining their evidence and sources.
 */
export function mergeCandidates(allCandidates: SuggestionCandidate[]): SuggestionCandidate[] {
  const byKey = new Map<string, SuggestionCandidate>();

  for (const candidate of allCandidates) {
    const key = normalizeSubtaskTitle(candidate.title);
    const existing = byKey.get(key);

    if (!existing) {
      // First occurrence — store it
      byKey.set(key, {
        title: candidate.title,
        sources: [...candidate.sources],
        evidence: [...candidate.evidence],
        rawScore: candidate.rawScore,
      });
    } else {
      // Merge: accumulate evidence and sources, keep highest rawScore
      const mergedSources = dedupSources([...existing.sources, ...candidate.sources]);
      const mergedEvidence = dedupEvidence([...existing.evidence, ...candidate.evidence]);
      const mergedScore = Math.max(existing.rawScore ?? 0, candidate.rawScore ?? 0);

      byKey.set(key, {
        // Tie goes to existing (first-seen) title
        title: mergedScore > (existing.rawScore ?? 0) ? candidate.title : existing.title,
        // Full merged sources array (first element is highest-priority)
        sources: mergedSources,
        evidence: mergedEvidence,
        rawScore: mergedScore,
      });
    }
  }

  return [...byKey.values()];
}

function dedupSources(sources: SuggestionCandidate['sources'][number][]): SuggestionCandidate['sources'] {
  const seen = new Set<SuggestionCandidate['sources'][number]>();
  const result: SuggestionCandidate['sources'] = [];
  for (const s of sources) {
    if (!seen.has(s)) { seen.add(s); result.push(s); }
  }
  return result;
}

function dedupEvidence(evidence: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const e of evidence) {
    if (!seen.has(e)) { seen.add(e); result.push(e); }
  }
  return result;
}
