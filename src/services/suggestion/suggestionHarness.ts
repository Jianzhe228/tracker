/**
 * Suggestion Harness — orchestrator for the Phase 1 suggestion pipeline.
 *
 * Phase 1 of the Suggestion Harness design.
 *
 * Replaces the old short-circuit pipeline (pattern → learning → AI) with:
 *   analyze_title → parallel_retrieve → merge → rank → (AI augmentation)
 *
 * The harness runs all local retrievers in parallel, merges their candidates,
 * and feeds the merged set to a unified ranker before returning results.
 */
import type { TitleAnalysis, RankedSuggestion, SuggestionCandidate } from '../../types/domain';
import type { Strategy } from './confidenceScorer';
import { analyzeTitle } from './titleAnalyzer';
import { computeConfidence } from './confidenceScorer';
import { mergeCandidates } from './candidateMerger';
import { rankCandidates } from './candidateRanker';
import { feedbackRejectedTitles } from '../commands/learning';
import {
  retrievePatternCandidates,
  retrieveLearningCandidates,
  retrieveHistoryCandidates,
  retrieveSiblingCandidates,
} from './retrievers';

export interface HarnessContext {
  taskId: number;
  taskTitle: string;
  projectId: number | null;
  existingSubtaskTitles: Set<string>;
}

export interface HarnessOutput {
  ranked: RankedSuggestion[];
  analysis: TitleAnalysis;
  strategy: Strategy;
  // Intermediate data for AI context building
  rejectedTitles: string[];
}

export interface AiContextInput {
  taskId: number;
  taskTitle: string;
  projectId: number | null;
  projectName: string;
  analysis: TitleAnalysis;
  ranked: RankedSuggestion[];
  rejectedTitles?: string[];
}

export interface AiContext {
  userPatterns: string;
  learnedItems: string;
  rejectedItems: string;
  manualSubtasks: string;
  siblingTasks: string;
}

/**
 * Run the full suggestion harness.
 * Returns ranked suggestions, title analysis, chosen strategy, and rejected titles.
 */
export async function runHarness(ctx: HarnessContext): Promise<HarnessOutput> {
  const analysis = analyzeTitle(ctx.taskTitle);

  if (analysis.keywords.length === 0) {
    return {
      ranked: [],
      analysis,
      strategy: 'ai',
      rejectedTitles: [],
    };
  }

  // Compute confidence to determine strategy
  const confidence = await computeConfidence(analysis.keywords, ctx.projectId);

  // Parallel retrieval from all local sources
  const [patternCandidates, learningCandidates, historyCandidates, siblingCandidates] =
    await Promise.all([
      retrievePatternCandidates(analysis.keywords, ctx.projectId),
      retrieveLearningCandidates(analysis.keywords, ctx.projectId),
      retrieveHistoryCandidates(ctx.taskTitle, analysis.keywords, ctx.projectId),
      retrieveSiblingCandidates(ctx.projectId, ctx.taskId, analysis.keywords),
    ]);

  // Merge all candidates from all sources
  const merged = mergeCandidates([
    ...patternCandidates,
    ...learningCandidates,
    ...historyCandidates,
    ...siblingCandidates,
  ]);

  // Get rejected titles for ranking penalties
  let rejectedTitles: string[] = [];
  try {
    rejectedTitles = await feedbackRejectedTitles(analysis.keywords, ctx.projectId);
  } catch {
    // Non-fatal — ranking will proceed without rejection data
  }

  // Rank merged candidates
  const ranked = rankCandidates(merged, analysis, {
    projectId: ctx.projectId,
    existingSubtaskTitles: ctx.existingSubtaskTitles,
    taskTitle: ctx.taskTitle,
  }, rejectedTitles);

  // Determine final strategy
  let strategy: Strategy = confidence.strategy;
  if (ranked.length > 0) {
    // We found candidates — use hybrid if confidence was 'ai', else keep confidence
    strategy = confidence.strategy === 'local' ? 'local' : 'hybrid';
  } else {
    // No candidates found — fallback strategy
    strategy = confidence.strategy === 'local' ? 'hybrid' : confidence.strategy;
  }

  return { ranked, analysis, strategy, rejectedTitles };
}

/**
 * Build AI context from harness output — no duplicate keyword extraction.
 * Uses the structured analysis and ranked candidates already computed.
 */
export async function buildAiContextFromAnalysis(
  input: AiContextInput,
): Promise<AiContext> {
  const { ranked } = input;

  // Extract pattern subtasks from ranked candidates
  const patternSubtasks = ranked
    .filter(r => r.sources.includes('pattern'))
    .map(r => r.title)
    .join(', ');

  // Extract learning/history suggestions
  const learnedSubtasks = ranked
    .filter(r => r.sources.includes('learning'))
    .map(r => r.title)
    .join(', ');

  // Manual subtasks from history source
  const manualSubtasks = ranked
    .filter(r => r.sources.includes('history'))
    .map(r => r.title)
    .join(', ');

  // Rejected items (passed in from harness or derived from ranked)
  const rejectedItems = input.ranked
    .filter(r => r.reasons.includes('previously_rejected'))
    .map(r => r.title)
    .join(', ');

  // Sibling tasks — need to query task store
  let siblingTasks = '';
  if (input.projectName) {
    try {
      // Use task store directly (siblingRetriever already does this)
      const { retrieveSiblingCandidates } = await import('./retrievers');
      const siblings = await retrieveSiblingCandidates(
        input.projectId ?? null,
        input.taskId,
        input.analysis.keywords,
      );
      siblingTasks = siblings.map(s => s.title).join(', ');
    } catch {
      // ignore
    }
  }

  return {
    userPatterns: patternSubtasks,
    learnedItems: learnedSubtasks,
    rejectedItems: rejectedItems || (input.rejectedTitles?.join(', ') ?? ''),
    manualSubtasks,
    siblingTasks,
  };
}

/**
 * Convert RankedSuggestion[] to SidebarSuggestion[] for UI consumption.
 * Also attaches patternName if available (from evidence).
 */
export function toSidebarSuggestions(
  ranked: RankedSuggestion[],
): Array<{
  title: string;
  source: 'pattern' | 'learning' | 'history' | 'sibling' | 'ai_generated';
  patternName?: string;
  children: NonNullable<RankedSuggestion['children']>;
  childCount: number;
}> {
  return ranked.map(r => {
    const patternName = extractPatternName(r.evidence);
    return {
      title: r.title,
      source: (r.sources[0] ?? 'learning') as 'pattern' | 'learning' | 'history' | 'sibling' | 'ai_generated',
      patternName,
      children: r.children ?? [],
      childCount: r.children?.length ?? 0,
    };
  });
}

function extractPatternName(evidence: string[]): string | undefined {
  for (const e of evidence) {
    if (e.startsWith('pattern: ')) {
      return e.slice('pattern: '.length);
    }
  }
  return undefined;
}
