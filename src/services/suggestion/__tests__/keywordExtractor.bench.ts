/**
 * Algorithm C 迭代：C → C2
 *
 * C2 = C 的噪声过滤 + V1 的相邻词组合 + P 的边界合并
 *
 * Run: npx tsx src/services/suggestion/__tests__/keywordExtractor.test.ts
 */

// ── Test data ───────────────────────────────────────────────────────

const TEST_CASES: [string, string[], string[]][] = [
  // [title, mustInclude[], mustExclude[]]

  // ── 日常生活 ──
  ['下午四点去菜市场买菜',    ['买菜', '菜市场'],         ['点去', '去菜', '点去菜']],
  ['下午四点买菜',            ['买菜'],                   ['点买', '四点买']],
  ['晚上八点去超市买东西',    ['超市', '买东西'],         ['点去']],
  ['明天早上洗衣服',          ['洗衣服'],                 []],
  ['周末打扫房间',            ['打扫', '房间'],           []],
  ['下班后去健身房锻炼',      ['健身房', '锻炼'],         []],
  ['中午去食堂吃饭',          ['食堂', '吃饭'],           []],
  ['傍晚去公园散步',          ['公园', '散步'],           []],

  // ── 学习 ──
  ['准备四六级考试',          ['四六级', '考试', '准备'],  []],
  ['复习高等数学第三章',      ['高等数学', '复习'],        []],
  ['写毕业论文开题报告',      ['毕业论文', '开题报告'],    []],
  ['背英语单词100个',         ['英语', '单词'],            []],
  ['学习Vue3组合式API',       ['学习', 'vue3'],            []],
  ['做线性代数作业',          ['线性代数', '作业'],        []],
  ['看完操作系统第五章',      ['操作系统'],                []],

  // ── 工作 ──
  ['写会议报告',              ['会议', '报告'],            []],
  ['写会议纪要',              ['会议', '纪要'],            []],
  ['提交项目周报',            ['项目', '周报', '提交'],    []],
  ['修复登录页面的Bug',       ['登录', '页面', 'bug'],     ['面的', '页面的']],
  ['review同事的PR',          ['review', 'pr'],            []],
  ['部署生产环境',            ['生产环境', '部署'],        []],
  ['优化数据库查询',          ['数据库', '查询', '优化'],  []],

  // ── 出行 ──
  ['天晚上六点去郑州找宁东',  ['郑州', '宁东'],            ['点去']],
  ['订明天去北京的高铁票',    ['北京', '高铁'],            []],
  ['预约下周二的牙医',        ['预约', '牙医'],            []],
  ['坐地铁去公司',            ['地铁', '公司'],            []],

  // ── 时间敏感 ──
  ['3点开会',                 ['开会'],                   []],
  ['早上跑步',                ['跑步'],                   []],
  ['每天背单词',              ['单词'],                   []],
  ['周五下午交报告',          ['报告'],                   []],
  ['后天上午去医院检查',      ['医院', '检查'],            []],
  ['星期三晚上开组会',        ['组会'],                   []],

  // ── 边界场景 ──
  ['买菜',                    ['买菜'],                   []],
  ['Fix the login bug',       ['fix', 'login', 'bug'],    []],
  ['9月1日开学准备',          ['开学', '准备'],            []],
  ['整理房间和洗衣服',        ['整理', '房间', '洗衣服'],  []],

  // ── 复合词恢复 ──
  ['写毕业论文任务书',        ['毕业论文'],                []],
  ['复习四级听力',            ['四级', '听力', '复习'],    []],
  ['开发用户登录功能',        ['登录', '功能'],            []],
  ['复习六级阅读',            ['六级', '阅读', '复习'],    []],
];

const SIMILARITY_PAIRS: [string, string][] = [
  ['下午四点去菜市场买菜', '下午四点买菜'],
  ['下午四点去菜市场买菜', '明天买菜'],
  ['早上跑步', '晚上跑步'],
  ['周五下午交报告', '明天交报告'],
  ['写会议报告', '写会议纪要'],
  ['提交项目周报', '写项目月报'],
  ['背英语单词100个', '背英语单词50个'],
  ['准备四六级考试', '复习四级听力'],
  ['下班后去健身房锻炼', '去健身房跑步'],
  ['订明天去北京的高铁票', '买去北京的火车票'],
  ['明天早上洗衣服', '下午洗衣服'],
  ['写毕业论文开题报告', '写毕业论文任务书'],
  ['修复登录页面的Bug', '修复登录功能Bug'],
  ['复习四级听力', '复习六级阅读'],
];

// ── Layer 3: Learn-log simulation ───────────────────────────────────
// Simulates the full pipeline: user creates tasks with subtasks,
// then checks if future similar tasks get correct suggestions
// and unrelated tasks don't get polluted.

interface HistoryEntry {
  taskTitle: string;
  subtasks: string[];
}

interface QueryTest {
  queryTitle: string;
  shouldSuggest: string[];    // subtask titles that SHOULD be suggested
  shouldNotSuggest: string[]; // subtask titles that should NOT appear
}

// Historical tasks — user previously created these with subtasks
const HISTORY: HistoryEntry[] = [
  {
    taskTitle: '下午四点去菜市场买菜',
    subtasks: ['列出购买清单', '带购物袋', '查看冰箱剩余食材'],
  },
  {
    taskTitle: '写会议报告',
    subtasks: ['整理会议记录', '列出行动项', '发送给参会人员'],
  },
  {
    taskTitle: '准备四六级考试',
    subtasks: ['背核心词汇', '做历年真题', '练听力'],
  },
  {
    taskTitle: '修复登录页面的Bug',
    subtasks: ['复现问题', '检查控制台报错', '写单元测试', '提交PR'],
  },
  {
    taskTitle: '下班后去健身房锻炼',
    subtasks: ['准备运动装备', '拉伸热身', '做力量训练'],
  },
  {
    taskTitle: '写毕业论文开题报告',
    subtasks: ['确定选题方向', '查阅文献综述', '撰写研究方案', '准备答辩PPT'],
  },
  {
    taskTitle: '订明天去北京的高铁票',
    subtasks: ['查班次时间', '选座位', '确认出发时间'],
  },
  {
    taskTitle: '周五下午交报告',
    subtasks: ['整理数据', '画图表', '写总结'],
  },
  {
    taskTitle: '复习高等数学第三章',
    subtasks: ['看教材笔记', '做课后习题', '总结公式'],
  },
  {
    taskTitle: '部署生产环境',
    subtasks: ['跑CI检查', '备份数据库', '执行迁移脚本', '验证功能'],
  },
];

// Query tasks — what should and should NOT be suggested
const QUERY_TESTS: QueryTest[] = [
  // 相似任务 → 应该命中
  {
    queryTitle: '明天买菜',
    shouldSuggest: ['列出购买清单', '带购物袋'],
    shouldNotSuggest: ['整理会议记录', '背核心词汇', '复现问题', '整理数据'],
  },
  {
    queryTitle: '下午四点买菜',
    shouldSuggest: ['列出购买清单'],
    shouldNotSuggest: ['整理会议记录', '整理数据', '画图表'],
  },
  {
    queryTitle: '写会议纪要',
    shouldSuggest: ['整理会议记录', '列出行动项'],
    shouldNotSuggest: ['列出购买清单', '复现问题', '背核心词汇'],
  },
  {
    queryTitle: '复习四级听力',
    shouldSuggest: ['背核心词汇', '做历年真题'],
    shouldNotSuggest: ['列出购买清单', '整理会议记录', '跑CI检查'],
  },
  {
    queryTitle: '修复登录功能Bug',
    shouldSuggest: ['复现问题', '检查控制台报错', '写单元测试'],
    shouldNotSuggest: ['列出购买清单', '整理会议记录', '背核心词汇'],
  },
  {
    queryTitle: '去健身房跑步',
    shouldSuggest: ['准备运动装备', '拉伸热身'],
    shouldNotSuggest: ['列出购买清单', '复现问题'],
  },
  {
    queryTitle: '写毕业论文任务书',
    shouldSuggest: ['确定选题方向', '查阅文献综述'],
    shouldNotSuggest: ['列出购买清单', '整理会议记录', '复现问题'],
  },
  {
    queryTitle: '买去北京的火车票',
    shouldSuggest: ['查班次时间', '选座位'],
    shouldNotSuggest: ['列出购买清单', '整理会议记录', '复现问题'],
  },
  {
    queryTitle: '明天交报告',
    shouldSuggest: ['整理数据', '画图表', '写总结'],
    shouldNotSuggest: ['列出购买清单', '复现问题', '背核心词汇'],
  },
  {
    queryTitle: '复习高等数学第五章',
    shouldSuggest: ['看教材笔记', '做课后习题', '总结公式'],
    shouldNotSuggest: ['列出购买清单', '整理会议记录'],
  },
  // 完全无关任务 → 不应该命中任何已有子任务
  {
    queryTitle: '给妈妈打电话',
    shouldSuggest: [],
    shouldNotSuggest: ['列出购买清单', '整理会议记录', '背核心词汇', '复现问题',
                       '准备运动装备', '确定选题方向', '查班次时间', '整理数据',
                       '看教材笔记', '跑CI检查'],
  },
  {
    queryTitle: '看一部电影',
    shouldSuggest: [],
    shouldNotSuggest: ['列出购买清单', '整理会议记录', '背核心词汇', '复现问题'],
  },
  {
    queryTitle: '今天下午三点开会',
    shouldSuggest: [],
    shouldNotSuggest: ['列出购买清单', '整理数据', '画图表', '带购物袋'],
  },
  // ── 时间词交叉污染测试 ──
  // 这些任务共享时间词但内容完全不同，不应该互相推荐
  {
    queryTitle: '下午写论文',      // 共享"下午"但不是买菜
    shouldSuggest: [],
    shouldNotSuggest: ['列出购买清单', '带购物袋', '查看冰箱剩余食材'],
  },
  {
    queryTitle: '下午去银行办事',   // 共享"下午"+"去"
    shouldSuggest: [],
    shouldNotSuggest: ['列出购买清单', '带购物袋', '准备运动装备', '拉伸热身'],
  },
  {
    queryTitle: '晚上看书',         // 共享"晚上"但不是去郑州
    shouldSuggest: [],
    shouldNotSuggest: ['查班次时间', '选座位', '确认出发时间'],
  },
  {
    queryTitle: '周五开会',         // 共享"周五"但不是交报告
    shouldSuggest: [],
    shouldNotSuggest: ['整理数据', '画图表', '写总结'],
  },
  {
    queryTitle: '明天下午去公园',   // 共享"明天"+"下午"+"去"
    shouldSuggest: [],
    shouldNotSuggest: ['列出购买清单', '查班次时间', '整理数据', '带购物袋'],
  },
];

// ── Utilities ───────────────────────────────────────────────────────

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
function segmentWords(text: string): string[] {
  const words: string[] = [];
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    if (isWordLike && segment.trim().length >= 1) words.push(segment);
  }
  return words;
}

function charJaccard(a: string, b: string): number {
  if (a === b) return 1;
  const setA = new Set([...a]), setB = new Set([...b]);
  let inter = 0;
  for (const ch of setA) { if (setB.has(ch)) inter++; }
  return inter / new Set([...setA, ...setB]).size;
}

// mustInclude: containment ok (市场 matches 菜市场)
function containsKeyword(keywords: string[], expected: string): boolean {
  const lower = expected.toLowerCase();
  return keywords.some(k => {
    const kl = k.toLowerCase();
    return kl === lower || kl.includes(lower) || lower.includes(kl);
  });
}

// mustExclude: exact match only (页面 should NOT trigger 页面的)
function containsExactNoise(keywords: string[], noise: string): boolean {
  const lower = noise.toLowerCase();
  return keywords.some(k => k.toLowerCase() === lower);
}

function fuzzyOverlap(kwA: string[], kwB: string[]): string[] {
  const matches: string[] = [], seen = new Set<string>();
  for (const a of kwA) for (const b of kwB) {
    const al = a.toLowerCase(), bl = b.toLowerCase(), key = `${al}|${bl}`;
    if (seen.has(key)) continue; seen.add(key);
    if (al === bl) { matches.push(a); continue; }
    if (al.includes(bl) || bl.includes(al)) { matches.push(`${a}⊃${b}`); continue; }
    if (charJaccard(a, b) >= 0.5) matches.push(`${a}≈${b}`);
  }
  return matches;
}

function extractEnglish(text: string): string[] {
  const m = text.match(/[a-zA-Z0-9]{2,}/g);
  return m ? m.map(w => w.toLowerCase()) : [];
}

// ── Noise detection ─────────────────────────────────────────────────

const TEMPORAL_WORDS = new Set([
  '早上', '上午', '中午', '下午', '傍晚', '晚上', '凌晨',
  '今天', '明天', '后天', '昨天', '前天', '大后天',
  '周末', '每天', '每周',
]);
const TEMPORAL_DAY_RE = /^(周[一二三四五六日]|星期[一二三四五六日天])$/;
const TEMPORAL_NUM_RE = /^[一二三四五六七八九十百千\d]+[点时分秒月日号年]$/;
function isTemporalWord(w: string): boolean {
  return TEMPORAL_WORDS.has(w) || TEMPORAL_DAY_RE.test(w) || TEMPORAL_NUM_RE.test(w);
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

// ══════════════════════════════════════════════════════════════════════
// ALGORITHM C (baseline)
// ══════════════════════════════════════════════════════════════════════

function algorithmC(title: string): string[] {
  const normalized = title.trim();
  if (!normalized) return [];
  const segments = segmentWords(normalized);
  if (segments.length === 0) {
    const chars = normalized.replace(/[^\u4e00-\u9fff]/g, '');
    const ng: string[] = [];
    for (let i = 0; i < chars.length - 1; i++) ng.push(chars.slice(i, i + 2));
    return ng.filter(n => !isNoiseNgram(n)).slice(0, 10);
  }

  const contentWords: string[] = [];
  const runs: string[][] = [];
  let run: string[] = [];

  for (const w of segments) {
    if (w.length === 1 && /[\u4e00-\u9fff]/.test(w)) { run.push(w); }
    else {
      if (run.length > 0) { runs.push([...run]); run = []; }
      if (!isTemporalWord(w)) contentWords.push(w);
    }
  }
  if (run.length > 0) runs.push(run);

  const seen = new Set(contentWords);
  const ngrams: string[] = [];

  for (const r of runs) {
    const subs: string[][] = []; let cur: string[] = [];
    for (const ch of r) {
      if (FUNC_HEADS.has(ch)) { if (cur.length > 0) subs.push([...cur]); cur = []; }
      else cur.push(ch);
    }
    if (cur.length > 0) subs.push(cur);
    for (const sub of subs) {
      for (let i = 0; i < sub.length - 1; i++) {
        const ng = sub[i] + sub[i + 1];
        if (!seen.has(ng) && !isNoiseNgram(ng)) { ngrams.push(ng); seen.add(ng); }
      }
      for (let i = 0; i < sub.length - 2; i++) {
        const ng = sub[i] + sub[i + 1] + sub[i + 2];
        if (!seen.has(ng) && !isNoiseNgram(ng)) { ngrams.push(ng); seen.add(ng); }
      }
    }
  }

  const result = [...new Set([...contentWords, ...ngrams])];
  for (const e of extractEnglish(normalized)) { if (!result.includes(e)) result.push(e); }
  return result.slice(0, 12);
}

// ══════════════════════════════════════════════════════════════════════
// ALGORITHM V1: Adjacent Join + Run N-grams (keeps temporal — for comparison)
// ══════════════════════════════════════════════════════════════════════

function algorithmV1(title: string): string[] {
  const normalized = title.trim();
  if (!normalized) return [];
  const segments = segmentWords(normalized);
  if (segments.length === 0) {
    const chars = normalized.replace(/[^\u4e00-\u9fff]/g, '');
    const ng: string[] = [];
    for (let i = 0; i < chars.length - 1; i++) ng.push(chars.slice(i, i + 2));
    return ng.slice(0, 10);
  }
  const result: string[] = [], seen = new Set<string>();
  const addU = (w: string, ml = 2) => { const l = w.toLowerCase(); if (!seen.has(l) && l.length >= ml) { seen.add(l); result.push(l); } };
  const cSegs: string[] = [], runs: string[][] = [];
  let run: string[] = [];
  for (const w of segments) {
    const ic = /[\u4e00-\u9fff]/.test(w);
    if (ic) { cSegs.push(w); if (w.length === 1) run.push(w); else { if (run.length > 0) { runs.push([...run]); run = []; } } }
    else { if (run.length > 0) { runs.push([...run]); run = []; } }
  }
  if (run.length > 0) runs.push(run);
  for (let i = 0; i < cSegs.length; i++) {
    if (cSegs[i].length >= 2) addU(cSegs[i]);
    if (i < cSegs.length - 1 && cSegs[i].length >= 2 && cSegs[i + 1].length >= 2) addU(cSegs[i] + cSegs[i + 1]);
  }
  for (const r of runs) {
    if (r.length >= 2) addU(r.join(''));
    for (let i = 0; i < r.length - 1; i++) addU(r[i] + r[i + 1]);
    for (let i = 0; i < r.length - 2; i++) addU(r[i] + r[i + 1] + r[i + 2]);
  }
  for (const e of extractEnglish(normalized)) addU(e, 2);
  return result.slice(0, 12);
}

// ══════════════════════════════════════════════════════════════════════
// ALGORITHM C2: C + 相邻词组合 + 边界合并
// ══════════════════════════════════════════════════════════════════════

function algorithmC2(title: string): string[] {
  const normalized = title.trim();
  if (!normalized) return [];
  const segments = segmentWords(normalized);
  if (segments.length === 0) {
    const chars = normalized.replace(/[^\u4e00-\u9fff]/g, '');
    const ng: string[] = [];
    for (let i = 0; i < chars.length - 1; i++) ng.push(chars.slice(i, i + 2));
    return ng.filter(n => !isNoiseNgram(n)).slice(0, 10);
  }

  // ── Pass 1: Classify segments, collect runs ──
  // Store segments with their types for boundary merge later
  type SegInfo = { text: string; type: 'content' | 'temporal' | 'run'; runIdx?: number };
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
  const add = (w: string) => { if (!seen.has(w) && w.length >= 2) { seen.add(w); return true; } return false; };

  // ── Pass 2: Adjacent multi-char word joins ──
  // Only join truly adjacent content words in ORIGINAL segment order (don't skip runs/temporal)
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

  // ── Pass 3: Single-char run recovery (with functional split) ──
  const runRecovered: Map<number, string[]> = new Map(); // runIdx → recovered words
  const runNgrams: string[] = [];

  for (let ri = 0; ri < runs.length; ri++) {
    const r = runs[ri];
    const subs: string[][] = []; let cur: string[] = [];
    for (const ch of r) {
      if (FUNC_HEADS.has(ch)) { if (cur.length > 0) subs.push([...cur]); cur = []; }
      else cur.push(ch);
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
    // e.g., 数据 + [库] → 数据库 (segmenter split a compound)
    // Only for run length 1 — longer runs are their own concepts
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

    // 4b. Last char of run (length>=2) + following content word
    // e.g., [四,点,去,菜] → 菜 + 市场 → 菜市场
    // Only for runs with 2+ chars — single-char runs use 4a instead
    if (r.length >= 2) {
      const lastChar = r[r.length - 1];
      if (!FUNC_HEADS.has(lastChar)) {
        const merged = lastChar + nextSeg.text;
        if (merged.length <= 5 && !isNoiseNgram(merged) && add(merged)) {
          boundaryMerges.push(merged);
        }
      }
    }

    // 4c. Recovered bigram from run + following content word
    // e.g., 开题 + 报告 → 开题报告
    const recovered = runRecovered.get(info.runIdx) || [];
    for (const rec of recovered) {
      if (rec.length === 2) {
        const merged = rec + nextSeg.text;
        if (merged.length <= 6 && !isNoiseNgram(merged) && add(merged)) {
          boundaryMerges.push(merged);
        }
      }
    }
  }

  // ── Assemble: content > adjacentJoins > runNgrams > boundaryMerges ──
  const result = [...contentWords, ...adjacentJoins, ...boundaryMerges, ...runNgrams];
  for (const e of extractEnglish(normalized)) { if (!result.includes(e)) result.push(e); }
  return [...new Set(result)].slice(0, 12);
}

// ══════════════════════════════════════════════════════════════════════
// EVALUATION
// ══════════════════════════════════════════════════════════════════════

interface Result {
  name: string;
  recall: number;
  noiseRate: number;
  avgKeywords: number;
  similarity: number;
  composite: number;
  failures: { title: string; keywords: string[]; missing: string[]; noise: string[] }[];
}

function evaluate(name: string, fn: (t: string) => string[]): Result {
  let totalExp = 0, totalFound = 0, totalNoise = 0, totalNoiseChecks = 0, totalKw = 0;
  const failures: Result['failures'] = [];

  for (const [title, mustInclude, mustExclude] of TEST_CASES) {
    const kw = fn(title);
    totalKw += kw.length;
    const missing: string[] = [], noise: string[] = [];
    for (const e of mustInclude) { if (containsKeyword(kw, e)) totalFound++; else missing.push(e); totalExp++; }
    for (const n of mustExclude) { if (containsExactNoise(kw, n)) { noise.push(n); totalNoise++; } totalNoiseChecks++; }
    if (missing.length > 0 || noise.length > 0) failures.push({ title, keywords: kw, missing, noise });
  }

  let simHits = 0;
  for (const [a, b] of SIMILARITY_PAIRS) {
    if (fuzzyOverlap(fn(a), fn(b)).length > 0) simHits++;
  }

  const recall = totalFound / totalExp;
  const noiseRate = totalNoiseChecks > 0 ? totalNoise / totalNoiseChecks : 0;
  const avgKw = totalKw / TEST_CASES.length;
  const sim = simHits / SIMILARITY_PAIRS.length;
  const eff = Math.max(0, 1 - Math.max(0, avgKw - 2) / 10);
  const composite = recall * 0.3 + (1 - noiseRate) * 0.25 + sim * 0.25 + eff * 0.2;

  return { name, recall, noiseRate, avgKeywords: avgKw, similarity: sim, composite, failures };
}

// ── Run ─────────────────────────────────────────────────────────────

const ALGORITHMS: [string, (t: string) => string[]][] = [
  ['C: 噪声过滤(基线)', algorithmC],
  ['C2: +相邻组合+边界合并', algorithmC2],
  ['V1: Adjacent+Run(对照)', algorithmV1],
];

console.log('═'.repeat(100));
console.log('  Algorithm C 迭代对比');
console.log(`  Layer 1: ${TEST_CASES.length} 提取用例 | Layer 2: ${SIMILARITY_PAIRS.length} 相似匹配 | Layer 3: ${QUERY_TESTS.length} 历史经验模拟`);
console.log('═'.repeat(100));

const results: Result[] = [];
for (const [name, fn] of ALGORITHMS) results.push(evaluate(name, fn));

console.log('\n📊 Layer 1+2 结果:\n');
console.log('算法'.padEnd(28) + 'Recall↑'.padEnd(10) + 'Noise↓'.padEnd(10) + 'AvgKW'.padEnd(10) + 'Sim↑'.padEnd(10) + 'Score↑'.padEnd(10));
console.log('─'.repeat(78));
for (const r of results) {
  console.log(
    r.name.padEnd(28) +
    `${(r.recall * 100).toFixed(1)}%`.padEnd(10) +
    `${(r.noiseRate * 100).toFixed(1)}%`.padEnd(10) +
    r.avgKeywords.toFixed(1).padEnd(10) +
    `${(r.similarity * 100).toFixed(1)}%`.padEnd(10) +
    `${(r.composite * 100).toFixed(1)}`.padEnd(10)
  );
}

// Failures
for (const r of results) {
  console.log(`\n${'─'.repeat(100)}`);
  console.log(`📌 ${r.name}`);
  if (r.failures.length === 0) {
    console.log('   ✅ 全部通过');
  } else {
    for (const f of r.failures) {
      const icon = f.missing.length > 0 ? '❌' : '⚠️';
      console.log(`   ${icon} "${f.title}"`);
      console.log(`      → [${f.keywords.join(', ')}]`);
      if (f.missing.length > 0) console.log(`      缺失: [${f.missing.join(', ')}]`);
      if (f.noise.length > 0) console.log(`      噪声: [${f.noise.join(', ')}]`);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// LAYER 3: Learn-log simulation
// ══════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(100)}`);
console.log('\n📊 Layer 3: 历史经验匹配模拟\n');

interface LearnLogEntry { keyword: string; subtaskTitle: string; score: number; }

function simulateLearnLog(fn: (t: string) => string[]): LearnLogEntry[] {
  const log: LearnLogEntry[] = [];
  for (const entry of HISTORY) {
    const keywords = fn(entry.taskTitle);
    for (const kw of keywords) {
      for (const st of entry.subtasks) {
        log.push({ keyword: kw, subtaskTitle: st, score: 2 }); // manual = +2
      }
    }
  }
  return log;
}

function querySuggestions(
  fn: (t: string) => string[],
  log: LearnLogEntry[],
  queryTitle: string,
): Map<string, number> {
  const queryKw = fn(queryTitle);
  const scores = new Map<string, number>();

  // Simulate fuzzy keyword expansion (like Rust backend)
  const allStoredKw = [...new Set(log.map(e => e.keyword))];
  const expanded = new Set(queryKw);
  for (const qkw of queryKw) {
    for (const skw of allStoredKw) {
      if (expanded.has(skw)) continue;
      if (skw.includes(qkw) || qkw.includes(skw)) { expanded.add(skw); continue; }
      if (charJaccard(qkw, skw) >= 0.5) expanded.add(skw);
    }
  }

  // Sum scores for matching subtasks
  for (const entry of log) {
    if (expanded.has(entry.keyword) && entry.score > 0) {
      scores.set(entry.subtaskTitle, (scores.get(entry.subtaskTitle) || 0) + entry.score);
    }
  }
  return scores;
}

interface LearnResult {
  name: string;
  truePositives: number;
  falseNegatives: number;
  falsePositives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  details: string[];
}

function evaluateLearnLog(name: string, fn: (t: string) => string[]): LearnResult {
  const log = simulateLearnLog(fn);
  let tp = 0, fn_ = 0, fp = 0, tn = 0;
  const details: string[] = [];

  for (const qt of QUERY_TESTS) {
    const suggestions = querySuggestions(fn, log, qt.queryTitle);
    const suggested = new Set(suggestions.keys());

    // Check shouldSuggest (true positives / false negatives)
    for (const s of qt.shouldSuggest) {
      if (suggested.has(s)) { tp++; }
      else {
        fn_++;
        details.push(`  ❌ MISS "${qt.queryTitle}" → 应建议 "${s}" 但未命中`);
      }
    }

    // Check shouldNotSuggest (false positives / true negatives)
    for (const s of qt.shouldNotSuggest) {
      if (suggested.has(s)) {
        fp++;
        const score = suggestions.get(s)!;
        details.push(`  ⚠️  LEAK "${qt.queryTitle}" → 错误建议 "${s}" (score=${score})`);
      } else {
        tn++;
      }
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn_ > 0 ? tp / (tp + fn_) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return { name, truePositives: tp, falseNegatives: fn_, falsePositives: fp, trueNegatives: tn, precision, recall, f1, details };
}

for (const [name, fn] of ALGORITHMS) {
  const lr = evaluateLearnLog(name, fn);
  console.log(`📌 ${lr.name}`);
  console.log(`   TP: ${lr.truePositives} | FN: ${lr.falseNegatives} | FP: ${lr.falsePositives} | TN: ${lr.trueNegatives}`);
  console.log(`   Precision: ${(lr.precision * 100).toFixed(1)}% | Recall: ${(lr.recall * 100).toFixed(1)}% | F1: ${(lr.f1 * 100).toFixed(1)}%`);
  if (lr.details.length === 0) {
    console.log('   ✅ 无错误建议，无遗漏');
  } else {
    for (const d of lr.details) console.log(d);
  }
  console.log('');
}

// Show learn_log size comparison
console.log('📦 Learn-log 规模:');
for (const [name, fn] of ALGORITHMS) {
  const log = simulateLearnLog(fn);
  const uniqueKw = new Set(log.map(e => e.keyword)).size;
  console.log(`   ${name.padEnd(28)} ${log.length} 条记录, ${uniqueKw} 个不同关键词`);
}

// Key comparison
console.log(`\n${'═'.repeat(100)}`);
console.log('\n📋 关键场景对比:\n');
const keyCases = [
  '下午四点去菜市场买菜', '写毕业论文开题报告', '复习高等数学第三章',
  '看完操作系统第五章', '修复登录页面的Bug', '部署生产环境',
  '优化数据库查询', '天晚上六点去郑州找宁东', '下午四点买菜',
  '早上跑步', '周五下午交报告', '整理房间和洗衣服',
];
for (const title of keyCases) {
  console.log(`  "${title}"`);
  for (const [name, fn] of ALGORITHMS) {
    console.log(`    ${name.padEnd(26)} → [${fn(title).join(', ')}]`);
  }
}
