/**
 * Keyword extractor for task titles.
 *
 * Algorithm C4 — evolved from C3 with scored candidate ranking + fragment
 * suppression. The C3 structural passes are unchanged; the fixed-priority
 * assembly (content > joins > merges > run n-grams) is replaced by a
 * per-candidate score (base score by origin + length / known-keyword
 * bonuses), and run-n-gram fragments covered by an already-kept longer
 * candidate are dropped.
 *
 * See __tests__/keywordExtractor.test.ts (baseline)
 *     __tests__/keywordExtractor.stress.ts (C2 vs C3 comparison)
 *
 * Strategy:
 * 1. Intl.Segmenter for Chinese word segmentation
 * 2. Filter temporal noise (时间词) — prevents learn_log cross-contamination
 * 3. Split single-char runs at functional particles, generate bigram+trigram
 * 4. Adjacent multi-char word joins (高等+数学 → 高等数学)
 * 5. Boundary merges (菜+市场 → 菜市场, 开题+报告 → 开题报告)
 *    - 4b structurally suppressed when 4c covers the same boundary
 * 6. Filter noise n-grams (functional heads/tails, temporal prefixes)
 * 7. Scored ranking: per-origin base + length bonus + known-keyword bonus
 *    (from learn_log); run fragments covered by kept candidates suppressed
 * 8. Fallback to n-gram extraction when Segmenter unavailable
 */

import { getKnownKeywords } from './keywordCache';

// ── Intl.Segmenter ─────────────────────────────────────────────────

const hasSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl;

let _segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (!hasSegmenter) return null;
  if (!_segmenter) {
    _segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  }
  return _segmenter;
}

function segmentWords(text: string): string[] {
  const segmenter = getSegmenter();
  if (!segmenter) return [];
  const words: string[] = [];
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    if (isWordLike && segment.trim().length >= 1) words.push(segment);
  }
  return words;
}

// ── Noise detection (closed linguistic classes) ────────────────────

export const TEMPORAL_WORDS = new Set([
  '早上', '上午', '中午', '下午', '傍晚', '晚上', '凌晨',
  '今天', '明天', '后天', '昨天', '前天', '大后天',
  '周末', '每天', '每周',
  '清晨', '深夜', '半夜', '午夜', '黄昏', '拂晓',
]);
const TEMPORAL_DAY_RE = /^(周[一二三四五六日]|星期[一二三四五六日天])$/;
const TEMPORAL_NUM_RE = /^[一二三四五六七八九十百千\d]+[点时分秒月日号年]$/;
const TEMPORAL_PERIOD_RE = /^[月年周][底初末中]$/;
const TEMPORAL_RELATIVE_RE = /^[上下这本去明后前][周月年]$/;

export function isTemporalWord(w: string): boolean {
  return TEMPORAL_WORDS.has(w) || TEMPORAL_DAY_RE.test(w) || TEMPORAL_NUM_RE.test(w)
    || TEMPORAL_PERIOD_RE.test(w) || TEMPORAL_RELATIVE_RE.test(w);
}

export const FUNC_HEADS = new Set('去到来在把的了着过给让被得地和或与'.split(''));
const PART_TAILS = new Set('的了着过得地'.split(''));
const TIME_HEADS = new Set('点时分秒'.split(''));

export function isNoiseNgram(ng: string): boolean {
  if (isTemporalWord(ng)) return true;
  if (FUNC_HEADS.has(ng[0])) return true;
  if (PART_TAILS.has(ng[ng.length - 1])) return true;
  if (TIME_HEADS.has(ng[0])) return true;
  if (ng.length >= 3 && isTemporalWord(ng.slice(0, 2))) return true;
  return false;
}

// ── N-gram fallback ────────────────────────────────────────────────

function extractNgrams(chineseChars: string): string[] {
  const ngrams: string[] = [];
  if (chineseChars.length < 2) return ngrams;
  for (let i = 0; i < chineseChars.length - 1; i++) {
    ngrams.push(chineseChars.slice(i, i + 2));
  }
  return ngrams;
}

// ── Pass 1: Segment classification ────────────────────────────────

export type SegInfo = { text: string; type: 'content' | 'temporal' | 'run'; runIdx?: number };

export interface ClassifySegmentsResult {
  segInfos: SegInfo[];
  contentWords: string[];
  runs: string[][];
}

/**
 * Classify segments into content / temporal / run groups.
 * Exported for reuse by titleAnalyzer.ts (Phase 1 harness).
 */
export function classifySegments(normalized: string): ClassifySegmentsResult {
  const segments = segmentWords(normalized);

  if (segments.length === 0) {
    return { segInfos: [], contentWords: [], runs: [] };
  }

  const segInfos: SegInfo[] = [];
  const contentWords: string[] = [];
  const runs: string[][] = [];
  let run: string[] = [];

  for (const w of segments) {
    if (w.length === 1 && /[\u4e00-\u9fff]/.test(w)) {
      run.push(w);
    } else {
      if (run.length > 0) {
        segInfos.push({ text: '', type: 'run', runIdx: runs.length });
        runs.push([...run]);
        run = [];
      }
      if (isTemporalWord(w)) {
        segInfos.push({ text: w, type: 'temporal' });
      } else {
        segInfos.push({ text: w, type: 'content' });
        contentWords.push(w);
      }
    }
  }
  if (run.length > 0) {
    segInfos.push({ text: '', type: 'run', runIdx: runs.length });
    runs.push([...run]);
  }

  return { segInfos, contentWords, runs };
}

// ── C3 Passes 2-4 (shared between extractKeywords and titleAnalyzer) ─

export interface C3PassesResult {
  adjacentJoins: string[];
  runNgrams: string[];
  boundaryMerges: string[];
  runRecovered: Map<number, string[]>;
}

/**
 * Run C3 algorithm passes 2-4 (adjacent joins, run recovery, boundary merges).
 * Exported for reuse by titleAnalyzer.ts to avoid duplicating the algorithm.
 */
export function computeC3Passes(
  segInfos: SegInfo[],
  runs: string[][],
): C3PassesResult {
  // ── Pass 2: Adjacent multi-char word joins ──
  // Only truly adjacent in original order (don't skip runs/temporal)

  const adjacentJoins: string[] = [];
  for (let si = 0; si < segInfos.length - 1; si++) {
    const a = segInfos[si], b = segInfos[si + 1];
    if (a.type === 'content' && b.type === 'content' &&
        a.text.length >= 2 && b.text.length >= 2) {
      const joined = a.text + b.text;
      if (joined.length <= 6 && !isNoiseNgram(joined)) {
        adjacentJoins.push(joined);
      }
    }
  }

  // ── Pass 3: Single-char run recovery (functional split + bigram/trigram) ──

  const runRecovered = new Map<number, string[]>();
  const runNgrams: string[] = [];

  for (let ri = 0; ri < runs.length; ri++) {
    const r = runs[ri];
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

    const recovered: string[] = [];
    for (const sub of subs) {
      for (let i = 0; i < sub.length - 1; i++) {
        const ng = sub[i] + sub[i + 1];
        if (!isNoiseNgram(ng)) { runNgrams.push(ng); recovered.push(ng); }
      }
      for (let i = 0; i < sub.length - 2; i++) {
        const ng = sub[i] + sub[i + 1] + sub[i + 2];
        if (!isNoiseNgram(ng)) { runNgrams.push(ng); recovered.push(ng); }
      }
    }
    runRecovered.set(ri, recovered);
  }

  // ── Pass 4: Boundary merges ──

  const boundaryMerges: string[] = [];

  for (let si = 0; si < segInfos.length; si++) {
    const info = segInfos[si];

    // 4a. Content word + single-char run (length=1) → compound recovery
    // e.g., 数据 + [库] → 数据库
    if (info.type === 'content' && info.text.length >= 2) {
      const nextInfo = segInfos[si + 1];
      if (nextInfo && nextInfo.type === 'run' && nextInfo.runIdx !== undefined) {
        const r = runs[nextInfo.runIdx];
        if (r.length === 1 && !FUNC_HEADS.has(r[0])) {
          const merged = info.text + r[0];
          if (merged.length <= 5 && !isNoiseNgram(merged)) {
            boundaryMerges.push(merged);
          }
        }
      }
    }

    if (info.type !== 'run' || info.runIdx === undefined) continue;

    const r = runs[info.runIdx];
    const nextSeg = segInfos[si + 1];
    if (!nextSeg || nextSeg.type !== 'content' || nextSeg.text.length < 2 ||
        !/[\u4e00-\u9fff]/.test(nextSeg.text)) continue;

    // 4c first: Recovered bigram + following content word
    // e.g., 开题 + 报告 → 开题报告
    const recovered = runRecovered.get(info.runIdx) || [];
    for (const rec of recovered) {
      if (rec.length === 2) {
        const merged = rec + nextSeg.text;
        if (merged.length <= 6 && !isNoiseNgram(merged)) {
          boundaryMerges.push(merged);
        }
      }
    }

    // 4b. Last char of run (length>=2) + following content word
    // e.g., [四,点,去,菜] → 菜 + 市场 → 菜市场
    // Structurally suppressed: if last char is already the tail of a recovered
    // bigram, 4b produces a cross-boundary fragment (化+数据→化数据). Skip it.
    if (r.length >= 2) {
      const lastChar = r[r.length - 1];
      const lastCharCovered = recovered.some(bg => bg.endsWith(lastChar));
      if (!lastCharCovered && !FUNC_HEADS.has(lastChar)) {
        const merged = lastChar + nextSeg.text;
        if (merged.length <= 5 && !isNoiseNgram(merged)) {
          boundaryMerges.push(merged);
        }
      }
    }
  }

  return { adjacentJoins, runNgrams, boundaryMerges, runRecovered };
}

// ── Main extraction ────────────────────────────────────────────────

export type KeywordOrigin = 'content' | 'join' | 'merge' | 'run' | 'english';

export interface ScoredKeyword {
  text: string;
  score: number;
  origin: KeywordOrigin;
}

const PURE_DIGIT_RE = /^[0-9]+$/;

// Base score by origin: segmenter content words are the most trustworthy,
// boundary merges / adjacent joins are recovered compounds, raw run n-grams
// are the weakest guesses; pure-digit english tokens carry little meaning
function baseScore(origin: KeywordOrigin, text: string): number {
  switch (origin) {
    case 'content': return 3.0;
    case 'merge': return 2.8;
    case 'join': return 2.7;
    case 'run': return [...text].length === 3 ? 1.8 : 1.6;
    case 'english': return PURE_DIGIT_RE.test(text) ? 1.2 : 2.4;
  }
}

/**
 * Extract keywords with per-candidate scores and origins (C4 assembly).
 * Candidates from all C3 passes compete on score; run-n-gram fragments
 * covered by an already-kept longer candidate are suppressed.
 */
export function extractKeywordsScored(title: string): ScoredKeyword[] {
  const normalized = title.trim();
  if (!normalized) return [];

  const known = getKnownKeywords();
  const { segInfos, contentWords, runs } = classifySegments(normalized);

  // Empty segmenter fallback — flat bigrams at run score
  if (segInfos.length === 0 && runs.length === 0) {
    const chars = normalized.replace(/[^\u4e00-\u9fff]/g, '');
    return extractNgrams(chars)
      .filter(ng => !isNoiseNgram(ng))
      .slice(0, 10)
      .map(ng => ({ text: ng, score: 1.6, origin: 'run' as const }));
  }

  const { adjacentJoins, runNgrams, boundaryMerges } = computeC3Passes(segInfos, runs);

  // ── Collect candidates in stable first-seen order ──

  const pool: Array<{ text: string; origin: KeywordOrigin }> = [
    ...contentWords.map(text => ({ text, origin: 'content' as const })),
    ...adjacentJoins.map(text => ({ text, origin: 'join' as const })),
    ...boundaryMerges.map(text => ({ text, origin: 'merge' as const })),
    ...runNgrams.map(text => ({ text, origin: 'run' as const })),
  ];

  const englishWords = normalized.match(/[a-zA-Z0-9]{2,}/g);
  if (englishWords) {
    for (const w of englishWords) {
      pool.push({ text: w.toLowerCase(), origin: 'english' });
    }
  }

  // ── Score + dedupe (highest score wins, first-seen index kept) ──

  const byText = new Map<string, ScoredKeyword & { index: number }>();
  for (let i = 0; i < pool.length; i++) {
    const { text, origin } = pool[i];
    const charLen = [...text].length;
    let score = baseScore(origin, text)
      + 0.25 * Math.min(Math.max(charLen - 2, 0), 3); // longer = more specific
    if (known.has(text)) score += 1.5;                 // seen in learn_log before

    const existing = byText.get(text);
    if (!existing) {
      byText.set(text, { text, score, origin, index: i });
    } else if (score > existing.score) {
      existing.score = score;
      existing.origin = origin;
    }
  }

  // ── Rank (score desc, ties by first appearance) + fragment suppression ──

  const ranked = [...byText.values()]
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const kept: ScoredKeyword[] = [];
  for (const cand of ranked) {
    // Drop run fragments strictly contained in an already-kept stronger
    // candidate (菜市 when 菜市场 was kept, run bigrams inside a kept run
    // trigram); content/join/merge/english candidates are never dropped
    const covered = cand.origin === 'run' && kept.some(k =>
      k.score >= cand.score && k.text.length > cand.text.length && k.text.includes(cand.text));
    if (!covered) {
      kept.push({ text: cand.text, score: cand.score, origin: cand.origin });
    }
  }

  return kept.slice(0, 12);
}

export function extractKeywords(title: string): string[] {
  return extractKeywordsScored(title).map(k => k.text);
}

/**
 * Compute character-level Jaccard similarity between two strings.
 */
export function charJaccard(a: string, b: string): number {
  if (a === b) return 1;
  const setA = new Set([...a]);
  const setB = new Set([...b]);
  let intersection = 0;
  for (const ch of setA) {
    if (setB.has(ch)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}
