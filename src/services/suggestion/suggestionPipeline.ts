/**
 * Suggestion pipeline — orchestrates the self-learning subtask suggestion system.
 *
 * Flow:
 * 1. Extract keywords from task title
 * 2. Compute confidence score (local data sufficiency)
 * 3. Based on strategy:
 *    - local (>= 0.7): return learn + pattern results only
 *    - hybrid (0.3-0.7): return local results + fire AI in background
 *    - ai (< 0.3): return empty + fire AI with full context
 */
import type { SuggestionResult } from '../../types/domain';
import { extractKeywords } from './keywordExtractor';
import { matchPatterns } from './patternMatcher';
import { suggestFromLearning } from './learningEngine';
import { computeConfidence, type Strategy } from './confidenceScorer';
import { historySuggest, feedbackRejectedTitles } from '../commands/learning';

const isTauri = '__TAURI_INTERNALS__' in window;

export interface SuggestionContext {
  taskTitle: string;
  projectId: number | null;
  projectName?: string;
}

export interface SuggestionOutput {
  result: SuggestionResult;
  strategy: Strategy;
  keywords: string[];
}

/**
 * Run the suggestion pipeline.
 * Returns local suggestions (if confident enough) and the chosen strategy.
 * The caller uses strategy to decide whether to also fire an AI job.
 */
export async function suggest(ctx: SuggestionContext): Promise<SuggestionOutput> {
  const keywords = extractKeywords(ctx.taskTitle);
  if (keywords.length === 0) {
    return {
      result: { source: 'none', suggestions: [] },
      strategy: 'ai',
      keywords: [],
    };
  }

  // Compute confidence to decide strategy
  const confidence = await computeConfidence(keywords, ctx.projectId);

  if (confidence.strategy === 'ai') {
    // Not enough local data — caller should fire AI
    return {
      result: { source: 'none', suggestions: [] },
      strategy: 'ai',
      keywords,
    };
  }

  // For local and hybrid: gather local suggestions
  const suggestions = await gatherLocalSuggestions(keywords, ctx.projectId);

  if (suggestions.suggestions.length === 0 && confidence.strategy === 'local') {
    // Confidence was high but no actual suggestions — fall back to hybrid
    return { result: suggestions, strategy: 'hybrid', keywords };
  }

  return {
    result: suggestions,
    strategy: confidence.strategy,
    keywords,
  };
}

async function gatherLocalSuggestions(
  keywords: string[],
  projectId: number | null,
): Promise<SuggestionResult> {
  // Layer 1: Pattern template match
  const patternResult = await matchPatterns(keywords, projectId);
  if (patternResult && patternResult.subtasks.length > 0) {
    return {
      source: 'pattern',
      suggestions: patternResult.subtasks,
      patternName: patternResult.pattern.name,
    };
  }

  // Layer 2: User behavior learning
  const learnResult = await suggestFromLearning(keywords, projectId);
  if (learnResult && learnResult.suggestions.length > 0) {
    return {
      source: 'learning',
      suggestions: learnResult.suggestions,
    };
  }

  return { source: 'none', suggestions: [] };
}

/**
 * Build enriched AI context from local data.
 * Provides maximum context to the AI for better suggestions.
 */
export async function buildAiContext(ctx: SuggestionContext): Promise<{
  userPatterns: string;
  learnedItems: string;
  rejectedItems: string;
  manualSubtasks: string;
  siblingTasks: string;
}> {
  const keywords = extractKeywords(ctx.taskTitle);

  let userPatterns = '';
  let learnedItems = '';
  let rejectedItems = '';
  let manualSubtasks = '';
  const siblingTasks = ''; // TODO: query sibling tasks from task store

  if (!isTauri || keywords.length === 0) {
    return { userPatterns, learnedItems, rejectedItems, manualSubtasks, siblingTasks };
  }

  try {
    const [patternResult, learnResult, rejected, history] = await Promise.all([
      matchPatterns(keywords, ctx.projectId),
      suggestFromLearning(keywords, ctx.projectId, 5),
      feedbackRejectedTitles(keywords, ctx.projectId),
      historySuggest(keywords, ctx.projectId, 8),
    ]);

    if (patternResult) {
      userPatterns = patternResult.subtasks.join(', ');
    }
    if (learnResult) {
      learnedItems = learnResult.suggestions.join(', ');
    }
    if (rejected.length > 0) {
      rejectedItems = rejected.join(', ');
    }
    if (history.length > 0) {
      manualSubtasks = history.join(', ');
    }
  } catch (e) {
    console.error('[suggestion-pipeline] buildAiContext failed', e);
  }

  return { userPatterns, learnedItems, rejectedItems, manualSubtasks, siblingTasks };
}

// Re-export for convenience
export { extractKeywords } from './keywordExtractor';
export { recordFeedback } from './learningEngine';
