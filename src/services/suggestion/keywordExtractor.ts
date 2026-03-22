/**
 * Generic keyword extractor for task titles.
 * Uses n-gram extraction + known keyword prioritization instead of a hardcoded dictionary.
 * Known keywords come from the learn log (user behavior history).
 */

import { getKnownKeywords } from './keywordCache';

// Common Chinese stop words to filter out
const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
  '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去',
  '你', '会', '着', '没有', '看', '好', '自己', '这', '他', '她',
  '它', '们', '那', '里', '为', '什么', '呢', '吗', '吧', '啊',
  '把', '被', '给', '让', '用', '从', '对', '可以', '能', '还',
  '等', '等下', '等一下', '马上', '先', '再', '又', '所以', '因为',
  '但是', '然后', '如果', '虽然', '已经', '正在', '可能', '应该',
  '需要', '想', '想要', '打算', '准备', '开始', '继续', '完成',
  '今天', '明天', '后天', '大后天', '昨天', '下午', '上午', '晚上',
  '早上', '中午', '周末', '这周', '下周', '本周',
]);

/**
 * Extract meaningful keywords from a task title.
 * Uses n-gram extraction with known keyword prioritization.
 */
export function extractKeywords(title: string): string[] {
  const normalized = title.trim();
  if (!normalized) return [];

  const known = getKnownKeywords();
  const knownMatches: Set<string> = new Set();
  const ngramCandidates: Set<string> = new Set();

  // 1. Extract Chinese n-grams (2-4 chars) and check against known keywords
  const chineseChars = normalized.replace(/[^\u4e00-\u9fff]/g, '');
  if (chineseChars.length >= 2) {
    for (let n = 4; n >= 2; n--) {
      for (let i = 0; i <= chineseChars.length - n; i++) {
        const ngram = chineseChars.slice(i, i + n);
        if (STOP_WORDS.has(ngram)) continue;
        if (known.has(ngram)) {
          knownMatches.add(ngram);
        } else {
          ngramCandidates.add(ngram);
        }
      }
    }
  } else if (chineseChars.length === 1 && !STOP_WORDS.has(chineseChars)) {
    ngramCandidates.add(chineseChars);
  }

  // 2. Extract English words (2+ chars)
  const englishWords = normalized.match(/[a-zA-Z]{2,}/g);
  if (englishWords) {
    for (const w of englishWords) {
      const lower = w.toLowerCase();
      if (!STOP_WORDS.has(lower)) {
        if (known.has(lower)) {
          knownMatches.add(lower);
        } else {
          ngramCandidates.add(lower);
        }
      }
    }
  }

  // 3. Prefer known keywords; fall back to n-gram candidates
  if (knownMatches.size > 0) {
    // Also include n-gram candidates that don't overlap with known matches
    const result = [...knownMatches];
    for (const candidate of ngramCandidates) {
      // Skip if this n-gram is a substring of a known match or vice versa
      let overlaps = false;
      for (const km of knownMatches) {
        if (km.includes(candidate) || candidate.includes(km)) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) result.push(candidate);
    }
    return result.slice(0, 10);
  }

  // No known keywords — use bigrams only (most reliable n-gram size)
  const bigrams: string[] = [];
  if (chineseChars.length >= 2) {
    for (let i = 0; i < chineseChars.length - 1; i++) {
      const bigram = chineseChars.slice(i, i + 2);
      if (!STOP_WORDS.has(bigram)) {
        bigrams.push(bigram);
      }
    }
  }

  // Merge with English words
  const allCandidates = [...bigrams];
  if (englishWords) {
    for (const w of englishWords) {
      const lower = w.toLowerCase();
      if (!STOP_WORDS.has(lower)) allCandidates.push(lower);
    }
  }

  return allCandidates.slice(0, 10);
}
