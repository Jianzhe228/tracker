/**
 * Suggestion service public API.
 *
 * Harness exports:
 *   runHarness       — main orchestrator (parallel retrieval + merge + rank)
 *   analyzeTitle     — structured title analysis
 *   buildAiContextFromAnalysis — AI context from harness output (no duplicate extraction)
 *   extractKeywords  — keyword extraction (used by aiStore)
 *   recordFeedback   — feedback recording (used by aiStore)
 */
export { runHarness, buildAiContextFromAnalysis, toSidebarSuggestions } from './suggestionHarness';
export { analyzeTitle } from './titleAnalyzer';
export { extractKeywords } from './keywordExtractor';
export { recordFeedback } from './learningEngine';
export type { HarnessContext, HarnessOutput, AiContext } from './suggestionHarness';
