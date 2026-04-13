/**
 * Title analyzer — produces structured TitleAnalysis from a task title.
 *
 * Phase 1 of the Suggestion Harness design.
 * Wraps the C3 keyword extractor and enriches its output with a full
 * segment trace and categorized hints.
 *
 * Delegates C3 passes to computeC3Passes() to avoid duplicating the algorithm.
 */
import type { TitleAnalysis } from '../../types/domain';
import { classifySegments, isNoiseNgram, FUNC_HEADS, isTemporalWord, computeC3Passes } from './keywordExtractor';
import { extractKeywords } from './keywordExtractor';
import { getKnownKeywords } from './keywordCache';

// ── Types ─────────────────────────────────────────────────────────

type TraceType = 'content' | 'temporal' | 'run' | 'english' | 'noise';
type TraceSource = 'segmenter' | 'recovery' | 'join' | 'fallback';

interface TracedKeyword {
  text: string;
  type: TraceType;
  source: TraceSource;
}

// ── Main analyzer ─────────────────────────────────────────────────

/**
 * Analyze a task title and return structured analysis.
 * The `keywords` field matches the output of `extractKeywords()`.
 */
export function analyzeTitle(title: string): TitleAnalysis {
  const rawTitle = title;
  const normalized = title.trim();

  if (!normalized) {
    return {
      rawTitle,
      normalizedTitle: '',
      keywords: [],
      intentHints: [],
      entityHints: [],
      timeHints: [],
      englishTerms: [],
      segmentTrace: [],
    };
  }

  // Get final keywords (the deduped, prioritized result)
  const keywords = extractKeywords(normalized);
  const known = getKnownKeywords();

  // Classify segments to get the trace structure
  const { segInfos, contentWords, runs } = classifySegments(normalized);

  // Delegate C3 passes to the shared implementation
  const { adjacentJoins, runNgrams, boundaryMerges, runRecovered } = computeC3Passes(segInfos, runs);

  // Build trace — map each classified segInfo to a traced item
  const traceMap = new Map<string, TracedKeyword[]>();

  for (const info of segInfos) {
    if (info.type === 'content') {
      addTrace(traceMap, info.text, 'content', 'segmenter');
    } else if (info.type === 'temporal') {
      addTrace(traceMap, info.text, 'temporal', 'segmenter');
    }
  }

  // Trace adjacent joins
  for (const joined of adjacentJoins) {
    addTrace(traceMap, joined, 'content', 'join');
  }

  // Trace run recovery
  for (const [ri, recovered] of runRecovered) {
    for (const ng of recovered) {
      addTrace(traceMap, ng, 'content', 'recovery');
    }
  }

  // Trace boundary merges
  for (const merged of boundaryMerges) {
    addTrace(traceMap, merged, 'content', 'recovery');
  }

  // ── English words ────────────────────────────────────────────────

  const englishWords: string[] = [];
  const englishMatches = normalized.match(/[a-zA-Z0-9]{2,}/g) ?? [];
  for (const w of englishMatches) {
    const lower = w.toLowerCase();
    englishWords.push(lower);
    addTrace(traceMap, lower, 'english', 'segmenter');
  }

  // ── Prioritize known keywords ─────────────────────────────────────

  const priorityResult: string[] = [...keywords];
  if (known.size > 0) {
    const knownKw: string[] = [];
    const unknownKw: string[] = [];
    for (const kw of [...new Set(keywords)]) {
      if (known.has(kw)) knownKw.push(kw);
      else unknownKw.push(kw);
    }
    const combined = [...knownKw, ...unknownKw];
    priorityResult.length = 0;
    for (let i = 0; i < Math.min(combined.length, 12); i++) {
      priorityResult.push(combined[i]);
    }
  }

  // ── Categorize hints ─────────────────────────────────────────────

  const timeHints = [...traceMap.entries()]
    .filter(([text, items]) => items.some(it => it.type === 'temporal'))
    .map(([text]) => text);

  const entityHints = [...traceMap.entries()]
    .filter(([text, items]) => items.some(it => it.type === 'content') && !isTemporalWord(text))
    .map(([text]) => text);

  const intentHints: string[] = [];

  const segmentTrace = buildSegmentTrace(traceMap, priorityResult);

  return {
    rawTitle,
    normalizedTitle: normalized,
    keywords: priorityResult,
    intentHints,
    entityHints,
    timeHints,
    englishTerms: englishWords,
    segmentTrace,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function addTrace(
  map: Map<string, TracedKeyword[]>,
  text: string,
  type: TraceType,
  source: TraceSource,
): void {
  if (!text) return;
  const existing = map.get(text);
  if (existing) {
    if (!existing.some(t => t.source === source)) {
      existing.push({ text, type, source });
    }
  } else {
    map.set(text, [{ text, type, source }]);
  }
}

function buildSegmentTrace(
  traceMap: Map<string, TracedKeyword[]>,
  keywords: string[],
): TitleAnalysis['segmentTrace'] {
  const seen = new Set<string>();
  const result: TitleAnalysis['segmentTrace'] = [];

  for (const kw of keywords) {
    const items = traceMap.get(kw);
    if (items && items.length > 0) {
      for (const item of items) {
        const key = `${item.text}|${item.type}|${item.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({
            text: item.text,
            type: item.type,
            source: item.source,
          });
        }
      }
    } else {
      result.push({ text: kw, type: 'content', source: 'segmenter' });
    }
  }

  return result;
}
