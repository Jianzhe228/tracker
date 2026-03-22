/**
 * Keyword extractor for task titles.
 *
 * Algorithm C3 — evolved from C2 with two structural improvements:
 *   A: Rule 4b suppression (skip when recovered bigram covers run's last char)
 *   B: Composable temporal patterns (regex-based, not enumerated)
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
 * 7. Known keywords (from learn_log) prioritized
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

const TEMPORAL_WORDS = new Set([
  '早上', '上午', '中午', '下午', '傍晚', '晚上', '凌晨',
  '今天', '明天', '后天', '昨天', '前天', '大后天',
  '周末', '每天', '每周',
  // 不可分解的时段词（与"早上/晚上"同类的封闭集）
  '清晨', '深夜', '半夜', '午夜', '黄昏', '拂晓',
]);
const TEMPORAL_DAY_RE = /^(周[一二三四五六日]|星期[一二三四五六日天])$/;
const TEMPORAL_NUM_RE = /^[一二三四五六七八九十百千\d]+[点时分秒月日号年]$/;
// 构词模式: 时间名词+位置后缀 (月底/年初/周中/...)
const TEMPORAL_PERIOD_RE = /^[月年周][底初末中]$/;
// 构词模式: 方向前缀+时间单位 (上周/下月/本年/...)
const TEMPORAL_RELATIVE_RE = /^[上下这本去明后前][周月年]$/;

function isTemporalWord(w: string): boolean {
  return TEMPORAL_WORDS.has(w) || TEMPORAL_DAY_RE.test(w) || TEMPORAL_NUM_RE.test(w)
    || TEMPORAL_PERIOD_RE.test(w) || TEMPORAL_RELATIVE_RE.test(w);
}

const FUNC_HEADS = new Set('去到来在把的了着过给让被得地和或与'.split(''));
const PART_TAILS = new Set('的了着过得地'.split(''));
const TIME_HEADS = new Set('点时分秒'.split(''));

function isNoiseNgram(ng: string): boolean {
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

// ── Main extraction ────────────────────────────────────────────────

type SegInfo = { text: string; type: 'content' | 'temporal' | 'run'; runIdx?: number };

export function extractKeywords(title: string): string[] {
  const normalized = title.trim();
  if (!normalized) return [];

  const known = getKnownKeywords();
  const segments = segmentWords(normalized);

  if (segments.length === 0) {
    const chars = normalized.replace(/[^\u4e00-\u9fff]/g, '');
    return extractNgrams(chars).filter(ng => !isNoiseNgram(ng)).slice(0, 10);
  }

  // ── Pass 1: Classify segments, collect runs ──

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

  const seen = new Set(contentWords);
  const add = (w: string) => {
    if (!seen.has(w) && w.length >= 2) { seen.add(w); return true; }
    return false;
  };

  // ── Pass 2: Adjacent multi-char word joins ──
  // Only truly adjacent in original order (don't skip runs/temporal)

  const adjacentJoins: string[] = [];
  for (let si = 0; si < segInfos.length - 1; si++) {
    const a = segInfos[si], b = segInfos[si + 1];
    if (a.type === 'content' && b.type === 'content' &&
        a.text.length >= 2 && b.text.length >= 2) {
      const joined = a.text + b.text;
      if (joined.length <= 6 && !isNoiseNgram(joined) && add(joined)) {
        adjacentJoins.push(joined);
      }
    }
  }

  // ── Pass 3: Single-char run recovery (functional split + bigram/trigram) ──

  const runRecovered = new Map<number, string[]>();
  const runNgrams: string[] = [];

  for (let ri = 0; ri < runs.length; ri++) {
    const r = runs[ri];
    // Split at functional chars
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
    if (cur.length > 0) subs.push(cur);

    const recovered: string[] = [];
    for (const sub of subs) {
      for (let i = 0; i < sub.length - 1; i++) {
        const ng = sub[i] + sub[i + 1];
        if (!isNoiseNgram(ng) && add(ng)) { runNgrams.push(ng); recovered.push(ng); }
      }
      for (let i = 0; i < sub.length - 2; i++) {
        const ng = sub[i] + sub[i + 1] + sub[i + 2];
        if (!isNoiseNgram(ng) && add(ng)) { runNgrams.push(ng); recovered.push(ng); }
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
          if (merged.length <= 5 && !isNoiseNgram(merged) && add(merged)) {
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
    let has4c = false;
    for (const rec of recovered) {
      if (rec.length === 2) {
        const merged = rec + nextSeg.text;
        if (merged.length <= 6 && !isNoiseNgram(merged) && add(merged)) {
          boundaryMerges.push(merged);
          has4c = true;
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
        if (merged.length <= 5 && !isNoiseNgram(merged) && add(merged)) {
          boundaryMerges.push(merged);
        }
      }
    }
  }

  // ── Assemble with priority: content > adjacentJoins > boundaryMerges > runNgrams ──

  const result = [...contentWords, ...adjacentJoins, ...boundaryMerges, ...runNgrams];

  const englishWords = normalized.match(/[a-zA-Z0-9]{2,}/g);
  if (englishWords) {
    for (const w of englishWords) {
      const lower = w.toLowerCase();
      if (!result.includes(lower)) result.push(lower);
    }
  }

  // Prioritize known keywords
  if (known.size > 0) {
    const knownKw: string[] = [];
    const unknownKw: string[] = [];
    for (const kw of [...new Set(result)]) {
      if (known.has(kw)) knownKw.push(kw);
      else unknownKw.push(kw);
    }
    return [...knownKw, ...unknownKw].slice(0, 12);
  }

  return [...new Set(result)].slice(0, 12);
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
