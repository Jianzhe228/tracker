/**
 * Suggestion service public API.
 *
 * Phase 1 harness exports:
 *   runHarness       — main orchestrator (parallel retrieval + merge + rank)
 *   analyzeTitle     — structured title analysis
 *   buildAiContextFromAnalysis — AI context from harness output (no duplicate extraction)
 *
 * Legacy exports (backward compatibility):
 *   suggest          — old pipeline (kept for any direct callers)
 *   buildAiContext   — old AI context builder (kept for any direct callers)
 *   extractKeywords  — keyword extraction (still used by aiStore)
 *   recordFeedback   — feedback recording (still used by aiStore)
 */
export { runHarness, buildAiContextFromAnalysis, toSidebarSuggestions } from './suggestionHarness';
export { analyzeTitle } from './titleAnalyzer';
export { extractKeywords } from './keywordExtractor';
export { recordFeedback } from './learningEngine';
export type { HarnessContext, HarnessOutput, AiContext } from './suggestionHarness';
export type { SuggestionContext } from './suggestionPipeline';

// Legacy re-exports — deprecated, do not use in new code
// eslint-disable-next-line @typescript-eslint/no-deprecated
export { suggest, buildAiContext } from './suggestionPipeline';
