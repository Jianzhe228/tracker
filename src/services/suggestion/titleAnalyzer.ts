/**
 * Title analyzer — produces structured TitleAnalysis from a task title.
 *
 * Phase 1 of the Suggestion Harness design.
 * Wraps the C4 keyword extractor and enriches its output with a full
 * segment trace and categorized hints. Intent hints are detected from a
 * closed action-verb class (INTENT_VERBS) over content words and the
 * verb+object pattern inside single-char runs.
 *
 * Delegates C3 passes to computeC3Passes() to avoid duplicating the algorithm.
 */
import type { TitleAnalysis } from '../../types/domain';
import { classifySegments, FUNC_HEADS, isTemporalWord, computeC3Passes } from './keywordExtractor';
import { extractKeywords } from './keywordExtractor';

// ── Intent verbs (closed action-word class) ───────────────────────

const INTENT_VERBS = new Set(['写','做','改','买','订','学','看','读','背','刷','修','聊','开','交','送','取','还','装','洗','练','跑','复习','预习','准备','完成','整理','处理','学习','撰写','编写','开发','修复','优化','重构','测试','部署','设计','调研','研究','安排','预约','提交','汇报','评审','审查','购买','采购','联系','沟通','跟进','检查','核对','录入','导出','分析','总结','规划','梳理']);

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

  // Get final keywords (the deduped, scored-ranked result)
  const keywords = extractKeywords(normalized);

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

  // ── Keyword order ────────────────────────────────────────────────

  // extractKeywords (C4) already applies known-keyword boosting in its
  // scoring — consume the keywords in returned order
  const priorityResult: string[] = keywords;

  // ── Categorize hints ─────────────────────────────────────────────

  const timeHints = [...traceMap.entries()]
    .filter(([text, items]) => items.some(it => it.type === 'temporal'))
    .map(([text]) => text);

  // Intent hints: multi-char content words that are action verbs (复习/准备/…),
  // plus the verb+object pattern inside single-char runs — split at functional
  // particles exactly like computeC3Passes, a sub-run's first char is the verb slot
  const intentCollected: string[] = [];
  const intentSeen = new Set<string>();
  const addIntent = (verb: string) => {
    if (!intentSeen.has(verb)) {
      intentSeen.add(verb);
      intentCollected.push(verb);
    }
  };

  for (const w of contentWords) {
    if (w.length >= 2 && INTENT_VERBS.has(w)) addIntent(w);
  }

  for (const r of runs) {
    const subs: string[][] = [];
    let cur: string[] = [];
    for (const ch of r) {
      if (FUNC_HEADS.has(ch)) {
        if (cur.length > 0) subs.push([...cur]);
        cur = [];
      } else {
        cur.push(ch);
      }
    }
    if (cur.length > 0) subs.push([...cur]);

    for (const sub of subs) {
      if (sub.length >= 2 && INTENT_VERBS.has(sub[0])) addIntent(sub[0]);
    }
  }

  const intentHints = intentCollected.slice(0, 3);
  const intentSet = new Set(intentHints);

  const entityHints = [...traceMap.entries()]
    .filter(([text, items]) =>
      items.some(it => it.type === 'content') && !isTemporalWord(text) && !intentSet.has(text))
    .map(([text]) => text);

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
