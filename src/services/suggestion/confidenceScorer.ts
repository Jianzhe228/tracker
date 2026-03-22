/**
 * Confidence scorer — determines whether to use local data, AI, or hybrid strategy.
 *
 * Factors:
 * - learn_log match count (score > 0)   weight: 0.35
 * - highest individual learn score      weight: 0.20
 * - task_subtask_history matches        weight: 0.25
 * - pattern template match              weight: 0.20
 */

import type { LearnStats } from '../../types/domain';
import { learnStats } from '../commands/learning';
import { matchPatterns } from './patternMatcher';

export type Strategy = 'local' | 'hybrid' | 'ai';

export interface ConfidenceResult {
  score: number;
  strategy: Strategy;
  hasPatternMatch: boolean;
}

const THRESHOLD_LOCAL = 0.7;
const THRESHOLD_HYBRID = 0.3;

// Score normalization caps
const MAX_MATCH_COUNT = 5;
const MAX_SCORE = 10;
const MAX_HISTORY = 3;

const isTauri = '__TAURI_INTERNALS__' in window;

export async function computeConfidence(
  keywords: string[],
  projectId: number | null,
): Promise<ConfidenceResult> {
  if (!isTauri || keywords.length === 0) {
    return { score: 0, strategy: 'ai', hasPatternMatch: false };
  }

  let stats: LearnStats = { matchCount: 0, maxScore: 0, totalFeedback: 0, historyCount: 0 };
  let hasPatternMatch = false;

  try {
    const [statsResult, patternResult] = await Promise.all([
      learnStats(keywords, projectId),
      matchPatterns(keywords, projectId),
    ]);
    stats = statsResult;
    hasPatternMatch = patternResult !== null && patternResult.subtasks.length > 0;
  } catch (e) {
    console.error('[confidence-scorer] failed', e);
    return { score: 0, strategy: 'ai', hasPatternMatch: false };
  }

  // Normalize each factor to 0-1
  const matchCountNorm = Math.min(stats.matchCount / MAX_MATCH_COUNT, 1);
  const maxScoreNorm = Math.min(stats.maxScore / MAX_SCORE, 1);
  const historyNorm = Math.min(stats.historyCount / MAX_HISTORY, 1);
  const patternNorm = hasPatternMatch ? 1 : 0;

  const score =
    matchCountNorm * 0.35 +
    maxScoreNorm * 0.20 +
    historyNorm * 0.25 +
    patternNorm * 0.20;

  let strategy: Strategy;
  if (score >= THRESHOLD_LOCAL) {
    strategy = 'local';
  } else if (score >= THRESHOLD_HYBRID) {
    strategy = 'hybrid';
  } else {
    strategy = 'ai';
  }

  return { score, strategy, hasPatternMatch };
}
