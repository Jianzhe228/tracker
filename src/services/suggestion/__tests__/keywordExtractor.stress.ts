/**
 * C2 vs C3 对比测试
 *
 * C3 = C2 + 两项通用改进:
 *   改进 A: Rule 4b 结构性抑制（末字被恢复词覆盖时跳过）
 *   改进 B: 组合式时间词模式（正则构词，非枚举）
 *
 * 同时跑基准测试（确保不退步）+ 管线压力测试（验证改进效果）
 *
 * Run: npx tsx src/services/suggestion/__tests__/keywordExtractor.stress.ts
 */

// ══════════════════════════════════════════════════════════════════════
// 共享基础设施
// ══════════════════════════════════════════════════════════════════════

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

const FUNC_HEADS = new Set('去到来在把的了着过给让被得地和或与'.split(''));
const PART_TAILS = new Set('的了着过得地'.split(''));
const TIME_HEADS = new Set('点时分秒'.split(''));

type SegInfo = { text: string; type: 'content' | 'temporal' | 'run'; runIdx?: number };

// ══════════════════════════════════════════════════════════════════════
// C2: 当前算法（与 keywordExtractor.ts 完全一致）
// ══════════════════════════════════════════════════════════════════════

const C2_TEMPORAL = new Set([
  '早上', '上午', '中午', '下午', '傍晚', '晚上', '凌晨',
  '今天', '明天', '后天', '昨天', '前天', '大后天',
  '周末', '每天', '每周',
]);
const C2_DAY_RE = /^(周[一二三四五六日]|星期[一二三四五六日天])$/;
const C2_NUM_RE = /^[一二三四五六七八九十百千\d]+[点时分秒月日号年]$/;

function c2IsTemporalWord(w: string): boolean {
  return C2_TEMPORAL.has(w) || C2_DAY_RE.test(w) || C2_NUM_RE.test(w);
}
function c2IsNoiseNgram(ng: string): boolean {
  if (c2IsTemporalWord(ng)) return true;
  if (FUNC_HEADS.has(ng[0])) return true;
  if (PART_TAILS.has(ng[ng.length - 1])) return true;
  if (TIME_HEADS.has(ng[0])) return true;
  if (ng.length >= 3 && c2IsTemporalWord(ng.slice(0, 2))) return true;
  return false;
}

function extractC2(title: string): string[] {
  const normalized = title.trim();
  if (!normalized) return [];
  const segments = segmentWords(normalized);
  if (segments.length === 0) {
    const chars = normalized.replace(/[^\u4e00-\u9fff]/g, '');
    const ng: string[] = [];
    for (let i = 0; i < chars.length - 1; i++) ng.push(chars.slice(i, i + 2));
    return ng.filter(n => !c2IsNoiseNgram(n)).slice(0, 10);
  }
  const segInfos: SegInfo[] = [];
  const contentWords: string[] = [];
  const runs: string[][] = [];
  let run: string[] = [];
  for (const w of segments) {
    if (w.length === 1 && /[\u4e00-\u9fff]/.test(w)) { run.push(w); }
    else {
      if (run.length > 0) { segInfos.push({ text: '', type: 'run', runIdx: runs.length }); runs.push([...run]); run = []; }
      if (c2IsTemporalWord(w)) { segInfos.push({ text: w, type: 'temporal' }); }
      else { segInfos.push({ text: w, type: 'content' }); contentWords.push(w); }
    }
  }
  if (run.length > 0) { segInfos.push({ text: '', type: 'run', runIdx: runs.length }); runs.push([...run]); }
  const seen = new Set(contentWords);
  const add = (w: string) => { if (!seen.has(w) && w.length >= 2) { seen.add(w); return true; } return false; };
  const adjacentJoins: string[] = [];
  for (let si = 0; si < segInfos.length - 1; si++) {
    const a = segInfos[si], b = segInfos[si + 1];
    if (a.type === 'content' && b.type === 'content' && a.text.length >= 2 && b.text.length >= 2) {
      const joined = a.text + b.text;
      if (joined.length <= 6 && !c2IsNoiseNgram(joined) && add(joined)) adjacentJoins.push(joined);
    }
  }
  const runRecovered = new Map<number, string[]>();
  const runNgrams: string[] = [];
  for (let ri = 0; ri < runs.length; ri++) {
    const r = runs[ri];
    const subs: string[][] = []; let cur: string[] = [];
    for (const ch of r) { if (FUNC_HEADS.has(ch)) { if (cur.length > 0) subs.push([...cur]); cur = []; } else cur.push(ch); }
    if (cur.length > 0) subs.push(cur);
    const recovered: string[] = [];
    for (const sub of subs) {
      for (let i = 0; i < sub.length - 1; i++) { const ng = sub[i] + sub[i + 1]; if (!c2IsNoiseNgram(ng) && add(ng)) { runNgrams.push(ng); recovered.push(ng); } }
      for (let i = 0; i < sub.length - 2; i++) { const ng = sub[i] + sub[i + 1] + sub[i + 2]; if (!c2IsNoiseNgram(ng) && add(ng)) { runNgrams.push(ng); recovered.push(ng); } }
    }
    runRecovered.set(ri, recovered);
  }
  const boundaryMerges: string[] = [];
  for (let si = 0; si < segInfos.length; si++) {
    const info = segInfos[si];
    if (info.type === 'content' && info.text.length >= 2) {
      const nextInfo = segInfos[si + 1];
      if (nextInfo && nextInfo.type === 'run' && nextInfo.runIdx !== undefined) {
        const r = runs[nextInfo.runIdx];
        if (r.length === 1 && !FUNC_HEADS.has(r[0])) {
          const merged = info.text + r[0];
          if (merged.length <= 5 && !c2IsNoiseNgram(merged) && add(merged)) boundaryMerges.push(merged);
        }
      }
    }
    if (info.type !== 'run' || info.runIdx === undefined) continue;
    const r = runs[info.runIdx];
    const nextSeg = segInfos[si + 1];
    if (!nextSeg || nextSeg.type !== 'content' || nextSeg.text.length < 2 || !/[\u4e00-\u9fff]/.test(nextSeg.text)) continue;
    if (r.length >= 2) {
      const lastChar = r[r.length - 1];
      if (!FUNC_HEADS.has(lastChar)) {
        const merged = lastChar + nextSeg.text;
        if (merged.length <= 5 && !c2IsNoiseNgram(merged) && add(merged)) boundaryMerges.push(merged);
      }
    }
    const recovered = runRecovered.get(info.runIdx) || [];
    for (const rec of recovered) {
      if (rec.length === 2) {
        const merged = rec + nextSeg.text;
        if (merged.length <= 6 && !c2IsNoiseNgram(merged) && add(merged)) boundaryMerges.push(merged);
      }
    }
  }
  const result = [...contentWords, ...adjacentJoins, ...boundaryMerges, ...runNgrams];
  const englishWords = normalized.match(/[a-zA-Z0-9]{2,}/g);
  if (englishWords) { for (const w of englishWords) { const lower = w.toLowerCase(); if (!result.includes(lower)) result.push(lower); } }
  return [...new Set(result)].slice(0, 12);
}

// ══════════════════════════════════════════════════════════════════════
// C3: 改进版算法
//   改进 A: Rule 4b 结构性抑制
//   改进 B: 组合式时间词模式
// ══════════════════════════════════════════════════════════════════════

// 改进 B: 组合式时间词模式（正则构词，不枚举单词）
const C3_TEMPORAL = new Set([
  '早上', '上午', '中午', '下午', '傍晚', '晚上', '凌晨',
  '今天', '明天', '后天', '昨天', '前天', '大后天',
  '周末', '每天', '每周',
  // 不可分解的时段词补充（与"早上/晚上"同类的封闭集）
  '清晨', '深夜', '半夜', '午夜', '黄昏', '拂晓',
]);
const C3_DAY_RE = /^(周[一二三四五六日]|星期[一二三四五六日天])$/;
const C3_NUM_RE = /^[一二三四五六七八九十百千\d]+[点时分秒月日号年]$/;
// 构词模式: 时间名词+位置后缀 (月底/年初/周中/...)
const C3_PERIOD_RE = /^[月年周][底初末中]$/;
// 构词模式: 方向前缀+时间单位 (上周/下月/本年/...)
const C3_RELATIVE_RE = /^[上下这本去明后前][周月年]$/;

function c3IsTemporalWord(w: string): boolean {
  return C3_TEMPORAL.has(w) || C3_DAY_RE.test(w) || C3_NUM_RE.test(w)
    || C3_PERIOD_RE.test(w) || C3_RELATIVE_RE.test(w);
}
function c3IsNoiseNgram(ng: string): boolean {
  if (c3IsTemporalWord(ng)) return true;
  if (FUNC_HEADS.has(ng[0])) return true;
  if (PART_TAILS.has(ng[ng.length - 1])) return true;
  if (TIME_HEADS.has(ng[0])) return true;
  if (ng.length >= 3 && c3IsTemporalWord(ng.slice(0, 2))) return true;
  return false;
}

function extractC3(title: string): string[] {
  const normalized = title.trim();
  if (!normalized) return [];
  const segments = segmentWords(normalized);
  if (segments.length === 0) {
    const chars = normalized.replace(/[^\u4e00-\u9fff]/g, '');
    const ng: string[] = [];
    for (let i = 0; i < chars.length - 1; i++) ng.push(chars.slice(i, i + 2));
    return ng.filter(n => !c3IsNoiseNgram(n)).slice(0, 10);
  }
  const segInfos: SegInfo[] = [];
  const contentWords: string[] = [];
  const runs: string[][] = [];
  let run: string[] = [];
  for (const w of segments) {
    if (w.length === 1 && /[\u4e00-\u9fff]/.test(w)) { run.push(w); }
    else {
      if (run.length > 0) { segInfos.push({ text: '', type: 'run', runIdx: runs.length }); runs.push([...run]); run = []; }
      if (c3IsTemporalWord(w)) { segInfos.push({ text: w, type: 'temporal' }); }
      else { segInfos.push({ text: w, type: 'content' }); contentWords.push(w); }
    }
  }
  if (run.length > 0) { segInfos.push({ text: '', type: 'run', runIdx: runs.length }); runs.push([...run]); }
  const seen = new Set(contentWords);
  const add = (w: string) => { if (!seen.has(w) && w.length >= 2) { seen.add(w); return true; } return false; };
  const adjacentJoins: string[] = [];
  for (let si = 0; si < segInfos.length - 1; si++) {
    const a = segInfos[si], b = segInfos[si + 1];
    if (a.type === 'content' && b.type === 'content' && a.text.length >= 2 && b.text.length >= 2) {
      const joined = a.text + b.text;
      if (joined.length <= 6 && !c3IsNoiseNgram(joined) && add(joined)) adjacentJoins.push(joined);
    }
  }
  const runRecovered = new Map<number, string[]>();
  const runNgrams: string[] = [];
  for (let ri = 0; ri < runs.length; ri++) {
    const r = runs[ri];
    const subs: string[][] = []; let cur: string[] = [];
    for (const ch of r) { if (FUNC_HEADS.has(ch)) { if (cur.length > 0) subs.push([...cur]); cur = []; } else cur.push(ch); }
    if (cur.length > 0) subs.push(cur);
    const recovered: string[] = [];
    for (const sub of subs) {
      for (let i = 0; i < sub.length - 1; i++) { const ng = sub[i] + sub[i + 1]; if (!c3IsNoiseNgram(ng) && add(ng)) { runNgrams.push(ng); recovered.push(ng); } }
      for (let i = 0; i < sub.length - 2; i++) { const ng = sub[i] + sub[i + 1] + sub[i + 2]; if (!c3IsNoiseNgram(ng) && add(ng)) { runNgrams.push(ng); recovered.push(ng); } }
    }
    runRecovered.set(ri, recovered);
  }
  // ── 改进 A: Pass 4 边界合并 + Rule 4b 结构性抑制 ──
  const boundaryMerges: string[] = [];
  for (let si = 0; si < segInfos.length; si++) {
    const info = segInfos[si];
    // 4a: content + single-char run (不变)
    if (info.type === 'content' && info.text.length >= 2) {
      const nextInfo = segInfos[si + 1];
      if (nextInfo && nextInfo.type === 'run' && nextInfo.runIdx !== undefined) {
        const r = runs[nextInfo.runIdx];
        if (r.length === 1 && !FUNC_HEADS.has(r[0])) {
          const merged = info.text + r[0];
          if (merged.length <= 5 && !c3IsNoiseNgram(merged) && add(merged)) boundaryMerges.push(merged);
        }
      }
    }
    if (info.type !== 'run' || info.runIdx === undefined) continue;
    const r = runs[info.runIdx];
    const nextSeg = segInfos[si + 1];
    if (!nextSeg || nextSeg.type !== 'content' || nextSeg.text.length < 2 || !/[\u4e00-\u9fff]/.test(nextSeg.text)) continue;

    // 先执行 4c（恢复词 + 后续 content）
    let has4c = false;
    const recovered = runRecovered.get(info.runIdx) || [];
    for (const rec of recovered) {
      if (rec.length === 2) {
        const merged = rec + nextSeg.text;
        if (merged.length <= 6 && !c3IsNoiseNgram(merged) && add(merged)) {
          boundaryMerges.push(merged);
          has4c = true;
        }
      }
    }

    // 改进 A: 4b 结构性抑制
    // 仅在 run 末字未被任何恢复词的末字覆盖时执行 4b
    if (r.length >= 2) {
      const lastChar = r[r.length - 1];
      const lastCharCovered = recovered.some(bg => bg.endsWith(lastChar));
      if (!lastCharCovered && !FUNC_HEADS.has(lastChar)) {
        const merged = lastChar + nextSeg.text;
        if (merged.length <= 5 && !c3IsNoiseNgram(merged) && add(merged)) boundaryMerges.push(merged);
      }
    }
  }
  const result = [...contentWords, ...adjacentJoins, ...boundaryMerges, ...runNgrams];
  const englishWords = normalized.match(/[a-zA-Z0-9]{2,}/g);
  if (englishWords) { for (const w of englishWords) { const lower = w.toLowerCase(); if (!result.includes(lower)) result.push(lower); } }
  return [...new Set(result)].slice(0, 12);
}

// ══════════════════════════════════════════════════════════════════════
// 管线模拟 (对齐 Rust learning.rs)
// ══════════════════════════════════════════════════════════════════════

interface LearnLogEntry { keyword: string; subtaskTitle: string; score: number; }
interface HistoryTask { title: string; subtasks: string[]; }

function expandKeywordsFuzzy(queryKeywords: string[], allStoredKeywords: string[]): Set<string> {
  const expanded = new Set(queryKeywords);
  for (const qkw of queryKeywords) {
    for (const skw of allStoredKeywords) {
      if (expanded.has(skw)) continue;
      if (skw.includes(qkw) || qkw.includes(skw)) { expanded.add(skw); continue; }
      if (charJaccard(qkw, skw) >= 0.5) expanded.add(skw);
    }
  }
  return expanded;
}

function buildLearnLog(history: HistoryTask[], fn: (t: string) => string[]): LearnLogEntry[] {
  const log: LearnLogEntry[] = [];
  for (const task of history) {
    for (const kw of fn(task.title)) {
      for (const st of task.subtasks) log.push({ keyword: kw, subtaskTitle: st, score: 2 });
    }
  }
  return log;
}

function learnSuggest(log: LearnLogEntry[], queryKw: string[], limit = 8): Map<string, number> {
  const allStoredKw = [...new Set(log.filter(e => e.score > 0).map(e => e.keyword))];
  const expanded = expandKeywordsFuzzy(queryKw, allStoredKw);
  const scores = new Map<string, number>();
  for (const e of log) {
    if (expanded.has(e.keyword) && e.score > 0) scores.set(e.subtaskTitle, (scores.get(e.subtaskTitle) || 0) + e.score);
  }
  return new Map([...scores.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, limit));
}

// ══════════════════════════════════════════════════════════════════════
// 测试数据
// ══════════════════════════════════════════════════════════════════════

const HISTORY: HistoryTask[] = [
  { title: '下午四点去菜市场买菜',     subtasks: ['列购物清单', '带环保袋', '查冰箱剩什么'] },
  { title: '周末打扫房间',             subtasks: ['收拾桌面', '拖地', '整理衣柜'] },
  { title: '下班后去健身房锻炼',       subtasks: ['带运动装备', '拉伸热身', '做力量训练'] },
  { title: '给妈妈过生日',             subtasks: ['买蛋糕', '订餐厅', '准备礼物'] },
  { title: '复习高等数学第三章',       subtasks: ['看教材笔记', '做课后习题', '总结公式'] },
  { title: '准备四六级考试',           subtasks: ['背核心词汇', '做历年真题', '练听力'] },
  { title: '写毕业论文开题报告',       subtasks: ['确定选题', '查阅文献', '撰写研究方案', '准备答辩PPT'] },
  { title: '修复登录页面的Bug',        subtasks: ['复现问题', '查日志', '写单元测试', '提交PR'] },
  { title: '优化数据库查询',           subtasks: ['分析慢查询', '加索引', '重写SQL', '压测验证'] },
  { title: '部署生产环境',             subtasks: ['跑CI', '备份数据库', '执行迁移', '验证功能'] },
  { title: '周五下午交报告',           subtasks: ['整理数据', '画图表', '写总结'] },
  { title: '订明天去北京的高铁票',     subtasks: ['查班次时间', '选座位', '确认出发时间'] },
  { title: '天晚上六点去郑州找宁东',   subtasks: ['订火车票', '带充电宝', '确认地址'] },
  { title: '学习React Hooks用法',      subtasks: ['看官方文档', '写demo', '重构旧组件'] },
  { title: 'refactor UserService模块',  subtasks: ['拆分大方法', '加类型注解', '补充测试'] },
];

// 基准测试用例（从 keywordExtractor.test.ts 移植核心用例）
const BASELINE_CASES: [string, string[], string[]][] = [
  ['下午四点去菜市场买菜',    ['买菜', '菜市场'],         ['点去', '去菜', '点去菜']],
  ['下午四点买菜',            ['买菜'],                   ['点买', '四点买']],
  ['晚上八点去超市买东西',    ['超市', '买东西'],         ['点去']],
  ['明天早上洗衣服',          ['洗衣服'],                 []],
  ['周末打扫房间',            ['打扫', '房间'],           []],
  ['准备四六级考试',          ['四六级', '考试', '准备'],  []],
  ['复习高等数学第三章',      ['高等数学', '复习'],        []],
  ['写毕业论文开题报告',      ['毕业论文', '开题报告'],    []],
  ['写会议报告',              ['会议', '报告'],            []],
  ['修复登录页面的Bug',       ['登录', '页面', 'bug'],     ['面的', '页面的']],
  ['优化数据库查询',          ['数据库', '查询', '优化'],  []],
  ['部署生产环境',            ['生产环境', '部署'],        []],
  ['天晚上六点去郑州找宁东',  ['郑州', '宁东'],            ['点去']],
  ['3点开会',                 ['开会'],                   []],
  ['早上跑步',                ['跑步'],                   []],
  ['周五下午交报告',          ['报告'],                   []],
  ['买菜',                    ['买菜'],                   []],
  ['Fix the login bug',       ['fix', 'login', 'bug'],    []],
  ['9月1日开学准备',          ['开学', '准备'],            []],
  ['整理房间和洗衣服',        ['整理', '房间', '洗衣服'],  []],
  // 新增: 验证改进 B 的时间词
  ['清晨跑步锻炼身体',        ['跑步', '锻炼', '身体'],  ['清晨']],
  ['深夜写代码',              ['代码'],                   ['深夜']],
  ['月底交项目报告',          ['项目', '报告'],           ['月底']],
  ['年底做总结',              ['总结'],                   ['年底']],
  ['下周一开会讨论',          ['开会', '讨论'],           []],
];

interface PipelineTest {
  queryTitle: string; shouldSuggest: string[]; shouldNotSuggest: string[];
  description: string; category: string;
}

const PIPELINE_TESTS: PipelineTest[] = [
  // 核心衔接
  { queryTitle: '明天买菜', shouldSuggest: ['列购物清单', '带环保袋'], shouldNotSuggest: ['看教材笔记', '复现问题', '整理数据'], description: '买菜→买菜经验', category: '核心衔接' },
  { queryTitle: '复习线性代数', shouldSuggest: ['看教材笔记', '做课后习题'], shouldNotSuggest: ['列购物清单', '复现问题'], description: '复习X→复习经验', category: '核心衔接' },
  { queryTitle: '复习四级听力', shouldSuggest: ['背核心词汇', '做历年真题'], shouldNotSuggest: ['列购物清单', '复现问题'], description: '四级→四六级', category: '核心衔接' },
  { queryTitle: '修复注册功能的Bug', shouldSuggest: ['复现问题', '查日志', '写单元测试'], shouldNotSuggest: ['列购物清单'], description: '修复Bug→修复经验', category: '核心衔接' },
  { queryTitle: '写毕业论文任务书', shouldSuggest: ['确定选题', '查阅文献'], shouldNotSuggest: ['列购物清单'], description: '毕业论文→开题经验', category: '核心衔接' },
  { queryTitle: '优化数据库索引', shouldSuggest: ['分析慢查询', '压测验证'], shouldNotSuggest: ['列购物清单'], description: '优化数据库→查询优化经验', category: '核心衔接' },
  { queryTitle: '买去北京的火车票', shouldSuggest: ['查班次时间', '选座位'], shouldNotSuggest: ['列购物清单'], description: '去北京→高铁票经验', category: '核心衔接' },
  { queryTitle: '去健身房跑步', shouldSuggest: ['带运动装备', '拉伸热身'], shouldNotSuggest: ['列购物清单'], description: '健身房→锻炼经验', category: '核心衔接' },
  { queryTitle: '学习Vue3组合式API', shouldSuggest: ['看官方文档', '写demo'], shouldNotSuggest: ['列购物清单'], description: '学习→React经验', category: '核心衔接' },
  { queryTitle: '明天交报告', shouldSuggest: ['整理数据', '画图表', '写总结'], shouldNotSuggest: ['列购物清单', '复现问题'], description: '报告→报告经验', category: '核心衔接' },
  // 时间词隔离
  { queryTitle: '下午写论文', shouldSuggest: [], shouldNotSuggest: ['列购物清单', '带环保袋', '查冰箱剩什么'], description: '共享"下午"不应推荐买菜', category: '时间词隔离' },
  { queryTitle: '下午去银行办事', shouldSuggest: [], shouldNotSuggest: ['列购物清单', '带运动装备'], description: '共享"下午"+"去"', category: '时间词隔离' },
  { queryTitle: '周五开会', shouldSuggest: [], shouldNotSuggest: ['整理数据', '画图表', '写总结'], description: '共享"周五"不应推荐报告', category: '时间词隔离' },
  { queryTitle: '明天下午去公园散步', shouldSuggest: [], shouldNotSuggest: ['列购物清单', '查班次时间', '整理数据', '带环保袋'], description: '三重时间词隔离', category: '时间词隔离' },
  { queryTitle: '晚上看书', shouldSuggest: [], shouldNotSuggest: ['订火车票', '带充电宝'], description: '共享"晚上"隔离', category: '时间词隔离' },
  // 完全无关
  { queryTitle: '给猫喂食', shouldSuggest: [], shouldNotSuggest: ['列购物清单', '看教材笔记', '复现问题', '整理数据', '带运动装备', '查班次时间', '跑CI', '确定选题'], description: '全新领域', category: '完全无关' },
  { queryTitle: '看一部电影', shouldSuggest: [], shouldNotSuggest: ['列购物清单', '看教材笔记', '复现问题'], description: '休闲活动', category: '完全无关' },
  { queryTitle: '学吉他', shouldSuggest: [], shouldNotSuggest: ['看官方文档', '写demo', '重构旧组件'], description: '"学"单字过滤', category: '完全无关' },
  // 噪声词探测
  { queryTitle: '优化前端性能', shouldSuggest: [], shouldNotSuggest: ['分析慢查询', '加索引', '重写SQL'], description: '"优化"桥接是否泄漏', category: '噪声词探测' },
  { queryTitle: '写开题答辩PPT', shouldSuggest: ['确定选题', '查阅文献', '准备答辩PPT'], shouldNotSuggest: ['列购物清单'], description: '开题→论文经验', category: '噪声词探测' },
  // 时间词探测
  { queryTitle: '清晨跑步', shouldSuggest: [], shouldNotSuggest: ['列购物清单', '看教材笔记', '复现问题'], description: '"清晨"探测', category: '时间词探测' },
  { queryTitle: '深夜写代码', shouldSuggest: [], shouldNotSuggest: ['列购物清单', '看教材笔记'], description: '"深夜"探测', category: '时间词探测' },
  { queryTitle: '月底交项目报告', shouldSuggest: ['整理数据', '画图表', '写总结'], shouldNotSuggest: ['列购物清单'], description: '"月底"探测+报告衔接', category: '时间词探测' },
  { queryTitle: '年底做总结', shouldSuggest: [], shouldNotSuggest: ['列购物清单', '复现问题', '带运动装备'], description: '"年底"探测', category: '时间词探测' },
];

// ══════════════════════════════════════════════════════════════════════
// 评估函数
// ══════════════════════════════════════════════════════════════════════

function containsKeyword(kws: string[], exp: string): boolean {
  const l = exp.toLowerCase();
  return kws.some(k => { const kl = k.toLowerCase(); return kl === l || kl.includes(l) || l.includes(kl); });
}
function containsExactNoise(kws: string[], noise: string): boolean {
  const l = noise.toLowerCase();
  return kws.some(k => k.toLowerCase() === l);
}

interface BaselineResult { name: string; recall: number; noiseRate: number; avgKw: number; failures: string[]; }
function evalBaseline(name: string, fn: (t: string) => string[]): BaselineResult {
  let totalExp = 0, totalFound = 0, totalNoise = 0, totalNoiseChecks = 0, totalKw = 0;
  const failures: string[] = [];
  for (const [title, mustInc, mustExc] of BASELINE_CASES) {
    const kw = fn(title);
    totalKw += kw.length;
    for (const e of mustInc) { if (containsKeyword(kw, e)) totalFound++; else failures.push(`  ❌ "${title}" 缺失 "${e}" → [${kw.join(', ')}]`); totalExp++; }
    for (const n of mustExc) { if (containsExactNoise(kw, n)) { totalNoise++; failures.push(`  ⚠️ "${title}" 噪声 "${n}" → [${kw.join(', ')}]`); } totalNoiseChecks++; }
  }
  return { name, recall: totalFound / totalExp, noiseRate: totalNoiseChecks > 0 ? totalNoise / totalNoiseChecks : 0, avgKw: totalKw / BASELINE_CASES.length, failures };
}

interface PipelineResult { name: string; tp: number; fn: number; fp: number; tn: number; precision: number; recall: number; f1: number; errors: string[]; }
function evalPipeline(name: string, fn: (t: string) => string[]): PipelineResult {
  const log = buildLearnLog(HISTORY, fn);
  let tp = 0, fn_ = 0, fp = 0, tn = 0;
  const errors: string[] = [];
  for (const t of PIPELINE_TESTS) {
    const qkw = fn(t.queryTitle);
    const sug = learnSuggest(log, qkw);
    const set = new Set(sug.keys());
    for (const s of t.shouldSuggest) { if (set.has(s)) tp++; else { fn_++; errors.push(`  ❌ MISS "${t.queryTitle}" → "${s}"`); } }
    for (const s of t.shouldNotSuggest) { if (set.has(s)) { fp++; errors.push(`  ⚠️ LEAK "${t.queryTitle}" → "${s}" (score=${sug.get(s)})`); } else tn++; }
  }
  const p = tp + fp > 0 ? tp / (tp + fp) : 1;
  const r = tp + fn_ > 0 ? tp / (tp + fn_) : (tp > 0 ? 1 : 0);
  const f = p + r > 0 ? 2 * p * r / (p + r) : 0;
  return { name, tp, fn: fn_, fp, tn, precision: p, recall: r, f1: f, errors };
}

// ══════════════════════════════════════════════════════════════════════
// 执行对比
// ══════════════════════════════════════════════════════════════════════

const ALGOS: [string, (t: string) => string[]][] = [
  ['C2 (当前)', extractC2],
  ['C3 (改进)', extractC3],
];

console.log('═'.repeat(100));
console.log('  C2 vs C3 对比测试');
console.log('═'.repeat(100));

// ── 基准测试 ──
console.log(`\n📊 基准测试 (${BASELINE_CASES.length} 用例):\n`);
console.log('算法'.padEnd(16) + 'Recall↑'.padEnd(10) + 'Noise↓'.padEnd(10) + 'AvgKW'.padEnd(10));
console.log('─'.repeat(46));
for (const [name, fn] of ALGOS) {
  const r = evalBaseline(name, fn);
  console.log(
    r.name.padEnd(16) +
    `${(r.recall * 100).toFixed(1)}%`.padEnd(10) +
    `${(r.noiseRate * 100).toFixed(1)}%`.padEnd(10) +
    r.avgKw.toFixed(1).padEnd(10)
  );
  if (r.failures.length > 0) { for (const f of r.failures) console.log(f); }
}

// ── 管线测试 ──
console.log(`\n📊 管线压力测试 (${PIPELINE_TESTS.length} 查询):\n`);
console.log('算法'.padEnd(16) + 'TP'.padEnd(6) + 'FN'.padEnd(6) + 'FP'.padEnd(6) + 'TN'.padEnd(6) + 'Prec↑'.padEnd(10) + 'Rec↑'.padEnd(10) + 'F1↑'.padEnd(10));
console.log('─'.repeat(70));
for (const [name, fn] of ALGOS) {
  const r = evalPipeline(name, fn);
  console.log(
    r.name.padEnd(16) +
    `${r.tp}`.padEnd(6) + `${r.fn}`.padEnd(6) + `${r.fp}`.padEnd(6) + `${r.tn}`.padEnd(6) +
    `${(r.precision * 100).toFixed(1)}%`.padEnd(10) +
    `${(r.recall * 100).toFixed(1)}%`.padEnd(10) +
    `${(r.f1 * 100).toFixed(1)}%`.padEnd(10)
  );
  if (r.errors.length > 0) { for (const e of r.errors) console.log(e); }
}

// ── 关键场景对比 ──
console.log(`\n📋 关键场景关键词对比:\n`);
const keyCases = [
  '优化数据库查询', '写毕业论文开题报告', '下午四点去菜市场买菜',
  '清晨跑步锻炼身体', '深夜写代码', '月底交项目报告', '年底做总结',
  '优化前端性能',
];
for (const title of keyCases) {
  console.log(`  "${title}"`);
  for (const [name, fn] of ALGOS) {
    console.log(`    ${name.padEnd(14)} → [${fn(title).join(', ')}]`);
  }
}

// ── Learn-log 规模 ──
console.log(`\n📦 Learn-log 规模:\n`);
for (const [name, fn] of ALGOS) {
  const log = buildLearnLog(HISTORY, fn);
  const uniqKw = new Set(log.map(e => e.keyword)).size;
  console.log(`  ${name.padEnd(14)} ${log.length} 条记录, ${uniqKw} 个不同关键词`);
}
