/**
 * Keyword extractor for task titles.
 *
 * Strategy:
 * 1. Use Intl.Segmenter (browser built-in, 0 bytes) for Chinese word segmentation
 * 2. NO hardcoded stop word or action word lists — all words are candidates
 * 3. Known keywords (from learn_log history) are prioritized
 * 4. The system learns which words matter through user behavior
 * 5. Fall back to n-gram extraction when Segmenter unavailable
 *
 * This ensures "写会议报告" and "写会议纪要" share keyword "会议",
 * and "准备四六级" extracts "四六级" as a unit.
 * Fuzzy matching in the Rust backend handles "四六级" ≈ "四级" ≈ "六级".
 */

import { getKnownKeywords } from './keywordCache';

// ── Intl.Segmenter detection ───────────────────────────────────────

const hasSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl;

let _segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (!hasSegmenter) return null;
  if (!_segmenter) {
    _segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  }
  return _segmenter;
}

/**
 * Segment text using Intl.Segmenter.
 * Returns word-like segments only (filters out punctuation/whitespace).
 */
function segmentWords(text: string): string[] {
  const segmenter = getSegmenter();
  if (!segmenter) return [];

  const words: string[] = [];
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    if (isWordLike && segment.trim().length >= 1) {
      words.push(segment);
    }
  }
  return words;
}

/**
 * Extract n-grams from Chinese text (fallback when Segmenter unavailable).
 */
function extractNgrams(chineseChars: string): string[] {
  const ngrams: string[] = [];
  if (chineseChars.length < 2) {
    if (chineseChars.length === 1) ngrams.push(chineseChars);
    return ngrams;
  }
  for (let i = 0; i < chineseChars.length - 1; i++) {
    ngrams.push(chineseChars.slice(i, i + 2));
  }
  return ngrams;
}

/**
 * Extract meaningful keywords from a task title.
 *
 * No hardcoded word lists — uses Intl.Segmenter for segmentation
 * and learn_log history (via keywordCache) for prioritization.
 */
export function extractKeywords(title: string): string[] {
  const normalized = title.trim();
  if (!normalized) return [];

  const known = getKnownKeywords();

  // 1. Try Intl.Segmenter for proper word segmentation
  const segments = segmentWords(normalized);

  if (segments.length > 0) {
    // Split into known (from history) and unknown words
    const knownWords: string[] = [];
    const unknownWords: string[] = [];

    for (const word of segments) {
      // Skip single-char Chinese "function" characters (的了在是...)
      // But keep single-char English/numbers and multi-char anything
      if (word.length === 1 && /[\u4e00-\u9fff]/.test(word)) {
        // Single Chinese char — only include if it's a known keyword
        if (known.has(word)) knownWords.push(word);
        continue;
      }
      if (known.has(word)) {
        knownWords.push(word);
      } else {
        unknownWords.push(word);
      }
    }

    // Prioritize: known words first, then unknown multi-char words
    const result = [...new Set([...knownWords, ...unknownWords])];

    // Extract English words separately (Segmenter may not split them well)
    const englishWords = normalized.match(/[a-zA-Z]{2,}/g);
    if (englishWords) {
      for (const w of englishWords) {
        const lower = w.toLowerCase();
        if (!result.includes(lower)) result.push(lower);
      }
    }

    return result.slice(0, 10);
  }

  // 2. Fallback: n-gram extraction (when Segmenter unavailable)
  const chineseChars = normalized.replace(/[^\u4e00-\u9fff]/g, '');
  const ngrams = extractNgrams(chineseChars);

  // Prefer known n-grams
  const knownNgrams = ngrams.filter(ng => known.has(ng));
  if (knownNgrams.length > 0) {
    const result = [...knownNgrams];
    for (const ng of ngrams) {
      if (known.has(ng)) continue;
      let overlaps = false;
      for (const kn of knownNgrams) {
        if (kn.includes(ng) || ng.includes(kn)) { overlaps = true; break; }
      }
      if (!overlaps) result.push(ng);
    }
    return result.slice(0, 10);
  }

  const allCandidates = [...ngrams];
  const englishWords = normalized.match(/[a-zA-Z]{2,}/g);
  if (englishWords) {
    for (const w of englishWords) {
      allCandidates.push(w.toLowerCase());
    }
  }

  return allCandidates.slice(0, 10);
}

/**
 * Compute character-level Jaccard similarity between two strings.
 * Used for fuzzy keyword matching.
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
