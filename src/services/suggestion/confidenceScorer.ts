/**
 * Confidence scorer — determines whether to use local data, AI, or hybrid strategy.
 *
 * v2 — smooth saturation + multi-source agreement: each factor saturates
 * smoothly (x / (x + k)) instead of hitting a hard cap, and the weighted base
 * is scaled by an agreement multiplier — independent sources (learn log,
 * manual history, patterns) agreeing is superlinear evidence, while a single
 * source alone is discounted.
 *
 * Factors:
 * - learn_log match count (score > 0)   sat(x, 1.5)   weight: 0.35
 * - highest individual learn score      sat(x, 2.5)   weight: 0.20
 * - task_subtask_history matches        sat(x, 0.8)   weight: 0.25
 * - pattern template match              0 | 1         weight: 0.20
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

// Saturation half-points: sat(k, k) = 0.5, asymptote 1 (no hard caps)
const SAT_MATCH_K = 1.5;
const SAT_SCORE_K = 2.5;
const SAT_HISTORY_K = 0.8;

/** Smooth saturation — monotonic, 0 at 0, approaches 1 asymptotically. */
const sat = (x: number, k: number): number => (x <= 0 ? 0 : x / (x + k));

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

  // Smoothly saturating factors (0-1)
  const matchFactor = sat(stats.matchCount, SAT_MATCH_K);
  const scoreFactor = sat(stats.maxScore, SAT_SCORE_K);
  const historyFactor = sat(stats.historyCount, SAT_HISTORY_K);
  const patternFactor = hasPatternMatch ? 1 : 0;

  const base =
    matchFactor * 0.35 +
    scoreFactor * 0.20 +
    historyFactor * 0.25 +
    patternFactor * 0.20;

  // Multi-source agreement: learn log (match/score), manual history and
  // patterns are independent evidence — agreement amplifies, a lone source
  // is discounted
  const sources = [
    matchFactor > 0 || scoreFactor > 0,
    historyFactor > 0,
    patternFactor > 0,
  ].filter(Boolean).length;
  const agreement = sources <= 1 ? 0.85 : sources === 2 ? 1.05 : 1.2;

  const score = Math.min(1, base * agreement);

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
