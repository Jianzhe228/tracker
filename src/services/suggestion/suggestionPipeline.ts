/**
 * Suggestion pipeline — orchestrates the 3-layer subtask suggestion system.
 *
 * Layer 1: Pattern template matching (instant, no AI)
 * Layer 2: User behavior learning (instant, no AI)
 * Layer 3: AI-enhanced suggestion (async, optional)
 */
import type { SuggestionResult } from '../../types/domain';
import { extractKeywords } from './keywordExtractor';
import { matchPatterns } from './patternMatcher';
import { suggestFromLearning } from './learningEngine';

export interface SuggestionContext {
  taskTitle: string;
  projectId: number | null;
  projectName?: string;
}

/**
 * Run the suggestion pipeline synchronously (layers 1-2 only).
 * Returns immediately with pattern or learning results.
 * AI layer is handled separately by the caller.
 */
export async function suggest(ctx: SuggestionContext): Promise<SuggestionResult> {
  const keywords = extractKeywords(ctx.taskTitle);
  if (keywords.length === 0) {
    return { source: 'none', suggestions: [] };
  }

  // Layer 1: Pattern template match
  const patternResult = await matchPatterns(keywords, ctx.projectId);
  if (patternResult && patternResult.subtasks.length > 0) {
    return {
      source: 'pattern',
      suggestions: patternResult.subtasks,
      patternName: patternResult.pattern.name,
    };
  }

  // Layer 2: User behavior learning
  const learnResult = await suggestFromLearning(keywords, ctx.projectId);
  if (learnResult && learnResult.suggestions.length > 0) {
    return {
      source: 'learning',
      suggestions: learnResult.suggestions,
    };
  }

  // No local results — caller should decide whether to invoke AI
  return { source: 'none', suggestions: [] };
}

/**
 * Build AI context enrichment from local data.
 * Used to inject user patterns/learned items into AI prompt.
 */
export async function buildAiContext(ctx: SuggestionContext): Promise<{
  userPatterns: string;
  learnedItems: string;
}> {
  const keywords = extractKeywords(ctx.taskTitle);

  let userPatterns = '';
  let learnedItems = '';

  // Get pattern data even if not enough for full match
  const patternResult = await matchPatterns(keywords, ctx.projectId);
  if (patternResult) {
    userPatterns = patternResult.subtasks.join(', ');
  }

  // Get learning data even if below threshold
  const learnResult = await suggestFromLearning(keywords, ctx.projectId, 5);
  if (learnResult) {
    learnedItems = learnResult.suggestions.join(', ');
  }

  return { userPatterns, learnedItems };
}

// Re-export for convenience
export { extractKeywords } from './keywordExtractor';
export { recordFeedback } from './learningEngine';
