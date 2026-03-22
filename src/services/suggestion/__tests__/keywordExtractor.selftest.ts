/**
 * Keyword Extractor Self-Test
 *
 * Tests the core algorithm without external dependencies.
 * Run: npx tsx src/services/suggestion/__tests__/keywordExtractor.selftest.ts
 */

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
    if (isWordLike && segment.trim().length >= 1) {
      words.push(segment);
    }
  }
  return words;
}

function extractNgrams(chineseChars: string): string[] {
  const ngrams: string[] = [];
  if (chineseChars.length < 2) return ngrams;
  for (let i = 0; i < chineseChars.length - 1; i++) {
    ngrams.push(chineseChars.slice(i, i + 2));
  }
  return ngrams;
}

function extractKeywords(title: string): string[] {
  const normalized = title.trim();
  if (!normalized) return [];

  const known = new Set<string>();
  const segments = segmentWords(normalized);

  if (segments.length === 0) {
    const chineseChars = normalized.replace(/[^\u4e00-\u9fff]/g, '');
    return extractNgrams(chineseChars).slice(0, 10);
  }

  const result: string[] = [];
  const seen = new Set<string>();

  const chineseSegments: string[] = [];
  const otherWords: string[] = [];
  const singleCharRuns: string[][] = [];
  let currentRun: string[] = [];

  for (const word of segments) {
    const isChinese = /[\u4e00-\u9fff]/.test(word);
    if (isChinese) {
      chineseSegments.push(word);
      if (word.length === 1) {
        currentRun.push(word);
      } else {
        if (currentRun.length > 0) {
          singleCharRuns.push([...currentRun]);
          currentRun = [];
        }
      }
    } else {
      if (currentRun.length > 0) {
        singleCharRuns.push([...currentRun]);
        currentRun = [];
      }
      otherWords.push(word);
    }
  }
  if (currentRun.length > 0) singleCharRuns.push(currentRun);

  const addUnique = (word: string, minLen = 2) => {
    const lower = word.toLowerCase();
    if (!seen.has(lower) && lower.length >= minLen) {
      seen.add(lower);
      result.push(lower);
    }
  };

  for (let i = 0; i < chineseSegments.length; i++) {
    const seg = chineseSegments[i];
    if (seg.length >= 2) {
      addUnique(seg);
    }
    if (i < chineseSegments.length - 1) {
      const next = chineseSegments[i + 1];
      if (seg.length >= 2 && next.length >= 2) {
        addUnique(seg + next);
      }
    }
  }

  for (const run of singleCharRuns) {
    if (run.length >= 2) {
      addUnique(run.join(''));
    }
    for (let i = 0; i < run.length - 1; i++) {
      addUnique(run[i] + run[i + 1]);
    }
    for (let i = 0; i < run.length - 2; i++) {
      addUnique(run[i] + run[i + 1] + run[i + 2]);
    }
  }

  for (const w of otherWords) {
    addUnique(w, 2);
  }

  const englishWords = normalized.match(/[a-zA-Z0-9]{2,}/g);
  if (englishWords) {
    for (const w of englishWords) {
      addUnique(w, 2);
    }
  }

  if (known.size > 0) {
    const knownKw: string[] = [];
    const unknownKw: string[] = [];
    for (const kw of result) {
      if (known.has(kw)) {
        knownKw.push(kw);
      } else {
        unknownKw.push(kw);
      }
    }
    return [...new Set([...knownKw, ...unknownKw])].slice(0, 12);
  }

  return result.slice(0, 12);
}

function charJaccard(a: string, b: string): number {
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

type ExtractionCase = {
  title: string;
  includes: string[];
};

type RetrievalCase = {
  query: string;
  expectedTop: string;
  forbiddenTop?: string[];
};

const EXTRACTION_CASES: ExtractionCase[] = [
  // === 日常生活 ===
  { title: '下午四点去菜市场买菜', includes: ['下午', '四点', '菜市场', '买菜'] },
  { title: '下午四点买菜', includes: ['下午', '四点', '买菜'] },
  { title: '晚上八点去超市买东西', includes: ['晚上', '超市', '买东西'] },
  { title: '明天早上洗衣服', includes: ['明天', '早上', '洗衣服'] },
  { title: '周末打扫房间', includes: ['周末', '打扫', '房间'] },
  { title: '下班后去健身房锻炼', includes: ['下班', '健身房', '锻炼'] },
  { title: '和女朋友去看电影', includes: ['女朋友', '看电影'] },
  { title: '给妈妈打电话', includes: ['妈妈', '打电话'] },

  // === 学习考试 ===
  { title: '准备四六级考试', includes: ['四六级', '考试'] },
  { title: '复习四级听力', includes: ['四级', '听力'] },
  { title: '复习六级阅读', includes: ['六级', '阅读'] },
  { title: '复习高等数学第三章', includes: ['高等数学', '复习'] },
  { title: '写毕业论文开题报告', includes: ['毕业论文', '开题报告'] },
  { title: '背英语单词100个', includes: ['英语', '单词'] },
  { title: '学习Vue3组合式API', includes: ['学习', 'vue3', 'api'] },
  { title: '刷LeetCode算法题', includes: ['leetcode', '算法'] },
  { title: '看机器学习视频', includes: ['机器学习', '视频'] },
  { title: '准备考研政治', includes: ['考研', '政治'] },
  { title: '做数据结构作业', includes: ['数据结构', '作业'] },

  // === 工作任务 ===
  { title: '写会议报告', includes: ['会议', '报告'] },
  { title: '写会议纪要', includes: ['会议', '纪要'] },
  { title: '提交项目周报', includes: ['项目', '周报'] },
  { title: '修复登录页面的Bug', includes: ['登录', '页面', 'bug'] },
  { title: 'review同事的PR', includes: ['review', 'pr'] },
  { title: '开发用户登录功能', includes: ['登录', '功能', '开发'] },
  { title: '优化首页加载速度', includes: ['首页', '加载', '优化'] },
  { title: '和产品经理开会讨论需求', includes: ['产品经理', '开会', '需求'] },
  { title: '写技术文档', includes: ['技术', '文档'] },
  { title: '重构订单模块代码', includes: ['重构', '订单', '模块'] },

  // === 出行安排 ===
  { title: '天晚上六点去郑州找宁东', includes: ['郑州', '宁东', '六点'] },
  { title: '订明天去北京的高铁票', includes: ['北京', '高铁'] },
  { title: '预约下周二的牙医', includes: ['预约', '牙医'] },
  { title: '订周五去上海的机票', includes: ['上海', '机票'] },
  { title: '去医院体检', includes: ['医院', '体检'] },

  // === 人名/专有名词 ===
  { title: '和张三吃饭', includes: ['张三', '吃饭'] },
  { title: '找李四拿快递', includes: ['李四', '快递'] },
  { title: '和王五讨论项目', includes: ['王五', '项目'] },

  // === 混合中英文 ===
  { title: 'AB测试新功能', includes: ['ab', '测试', '功能'] },
  { title: '写PPT汇报材料', includes: ['ppt', '汇报'] },
  { title: '参加Zoom会议', includes: ['zoom', '会议'] },
  { title: '用Figma画原型图', includes: ['figma', '原型'] },

  // === 数字相关 ===
  { title: '跑步30分钟', includes: ['跑步', '30'] },
  { title: '阅读50页书', includes: ['阅读', '50'] },
  { title: '做100个俯卧撑', includes: ['俯卧撑', '100'] },
];

const HISTORY_TITLES = [
  '下午四点买菜',
  '准备四六级考试',
  '写会议纪要',
  '买去北京的火车票',
  '修复登录页面的Bug',
  '写毕业论文开题报告',
  '去健身房跑步',
  '背英语单词50个',
  '复习四级听力',
  '开发用户登录模块',
];

const RETRIEVAL_CASES: RetrievalCase[] = [
  // 基本相似
  { query: '下午四点去菜市场买菜', expectedTop: '下午四点买菜' },
  { query: '写会议报告', expectedTop: '写会议纪要', forbiddenTop: ['下午四点买菜'] },
  { query: '订明天去北京的高铁票', expectedTop: '买去北京的火车票' },
  { query: '写毕业论文任务书', expectedTop: '写毕业论文开题报告', forbiddenTop: ['下午四点买菜', '写会议纪要'] },
  
  // Fuzzy匹配测试
  { query: '复习四级听力', expectedTop: '准备四六级考试' },
  { query: '复习六级阅读', expectedTop: '准备四六级考试' },
  { query: '背英语单词100个', expectedTop: '背英语单词50个' },
  
  // 场景匹配
  { query: '下班后去健身房锻炼', expectedTop: '去健身房跑步' },
  { query: '修复登录功能Bug', expectedTop: '修复登录页面的Bug' },
  { query: '开发用户登录功能', expectedTop: '开发用户登录模块' },
];

function normalize(values: string[]): string[] {
  return values.map((value) => value.toLowerCase());
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. expected="${String(expected)}" actual="${String(actual)}"`);
  }
}

function containsKeyword(keywords: string[], expected: string): boolean {
  const lowerExpected = expected.toLowerCase();
  return keywords.some((keyword) => {
    const lowerKeyword = keyword.toLowerCase();
    return lowerKeyword === lowerExpected
      || lowerKeyword.includes(lowerExpected)
      || lowerExpected.includes(lowerKeyword);
  });
}

function matchWeight(a: string, b: string): number {
  if (a === b) return 3;
  if (a.includes(b) || b.includes(a)) return 2;
  if (charJaccard(a, b) >= 0.5) return 1;
  return 0;
}

function scoreTitles(queryTitle: string, historyTitle: string): number {
  const queryKeywords = normalize(extractKeywords(queryTitle));
  const historyKeywords = normalize(extractKeywords(historyTitle));

  let score = 0;
  const seenPairs = new Set<string>();

  for (const queryKeyword of queryKeywords) {
    for (const historyKeyword of historyKeywords) {
      const pairKey = `${queryKeyword}::${historyKeyword}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      score += matchWeight(queryKeyword, historyKeyword);
    }
  }

  return score;
}

function runExtractionChecks(): { passed: number; failed: number } {
  console.log('\n[Extraction Checks]');

  let passed = 0;
  let failed = 0;

  for (const testCase of EXTRACTION_CASES) {
    const keywords = normalize(extractKeywords(testCase.title));
    
    let allFound = true;
    for (const expected of testCase.includes) {
      if (!containsKeyword(keywords, expected)) {
        allFound = false;
        break;
      }
    }

    if (allFound) {
      passed++;
      console.log(`✅ ${testCase.title}`);
      console.log(`   -> [${keywords.join(', ')}]`);
    } else {
      failed++;
      console.log(`❌ ${testCase.title}`);
      console.log(`   expected: [${testCase.includes.join(', ')}]`);
      console.log(`   got: [${keywords.join(', ')}]`);
    }
  }

  return { passed, failed };
}

function runRetrievalChecks(): { passed: number; failed: number } {
  console.log('\n[Retrieval Checks]');

  let passed = 0;
  let failed = 0;

  for (const testCase of RETRIEVAL_CASES) {
    const ranked = HISTORY_TITLES
      .map((historyTitle) => ({
        historyTitle,
        score: scoreTitles(testCase.query, historyTitle),
        keywords: normalize(extractKeywords(historyTitle)),
      }))
      .sort((a, b) => b.score - a.score || a.historyTitle.localeCompare(b.historyTitle, 'zh-CN'));

    const topMatch = ranked[0]?.historyTitle;
    const isCorrect = topMatch === testCase.expectedTop;
    const isForbidden = testCase.forbiddenTop?.includes(topMatch ?? '');

    if (isCorrect && !isForbidden) {
      passed++;
      console.log(`✅ ${testCase.query} → ${topMatch} (${ranked[0]?.score})`);
    } else {
      failed++;
      console.log(`❌ ${testCase.query}`);
      console.log(`   expected: ${testCase.expectedTop}`);
      console.log(`   got: ${topMatch} (${ranked[0]?.score})`);
      console.log(`   candidates: ${ranked.slice(0, 3).map(r => `${r.historyTitle}:${r.score}`).join(' | ')}`);
    }
  }

  return { passed, failed };
}

function runFuzzyMatchingDemo(): void {
  console.log('\n[Fuzzy Matching Examples]');

  const fuzzyPairs = [
    ['四六级', '四级'],
    ['六级', '四级'],
    ['毕业论文', '论文'],
    ['高等数学', '数学'],
    ['买菜', '菜市场'],
    ['健身房', '健身'],
  ];

  for (const [a, b] of fuzzyPairs) {
    const sim = charJaccard(a, b);
    const icon = sim >= 0.5 ? '✅' : '⚠️';
    console.log(`  ${icon} "${a}" ↔ "${b}": ${(sim * 100).toFixed(0)}%`);
  }
}

function main(): void {
  console.log('='.repeat(60));
  console.log('Keyword Extractor Self-Test');
  console.log('='.repeat(60));

  const extraction = runExtractionChecks();
  const retrieval = runRetrievalChecks();
  
  runFuzzyMatchingDemo();

  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log(`  Extraction: ${extraction.passed}/${extraction.passed + extraction.failed} passed`);
  console.log(`  Retrieval:  ${retrieval.passed}/${retrieval.passed + retrieval.failed} passed`);
  console.log('='.repeat(60));

  if (extraction.failed > 0 || retrieval.failed > 0) {
    process.exit(1);
  }
}

main();
