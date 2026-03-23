#!/usr/bin/env node
/**
 * Prompt evaluation script for AI subtask suggestions.
 *
 * Tests multiple prompt variants against diverse task scenarios,
 * auto-scores results, and outputs a comparison report.
 *
 * Usage:
 *   AI_ENDPOINT=https://xxx AI_KEY=sk-xxx AI_MODEL=gpt-4o-mini node scripts/prompt-eval.mjs
 *
 * Optional:
 *   RUNS=2          — repeat each test N times (default: 1)
 *   CANDIDATES=A,B  — only test specific candidates (default: all)
 */

// ─── Config ──────────────────────────────────────────────────────────
const ENDPOINT = process.env.AI_ENDPOINT;
const API_KEY  = process.env.AI_KEY;
const MODEL    = process.env.AI_MODEL || 'gpt-4o-mini';
const RUNS     = parseInt(process.env.RUNS || '1', 10);
const ONLY     = process.env.CANDIDATES?.split(',').map(s => s.trim());

if (!ENDPOINT || !API_KEY) {
  console.error('Usage: AI_ENDPOINT=... AI_KEY=... node scripts/prompt-eval.mjs');
  process.exit(1);
}

function apiUrl(endpoint) {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  return /\/chat\/completions\/?$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

// ─── Test Scenarios ──────────────────────────────────────────────────
const SCENARIOS = [
  {
    name: '简单-买菜',
    taskTitle: '去超市买菜',
    projectName: '',
    detailLevel: 'simple',
    userPatterns: '',
    learnedItems: '',
    rejectedItems: '',
    manualSubtasks: '',
    siblingTasks: '',
  },
  {
    name: '学习-四级考试',
    taskTitle: '准备英语四级考试',
    projectName: '学习',
    detailLevel: 'normal',
    userPatterns: '',
    learnedItems: '背单词, 做真题',
    rejectedItems: '制定复习计划',
    manualSubtasks: '听力练习, 阅读理解专项, 写作模板整理',
    siblingTasks: '复习高数, 准备期末论文',
  },
  {
    name: '工作-周报',
    taskTitle: '写本周工作周报',
    projectName: '工作',
    detailLevel: 'normal',
    userPatterns: '',
    learnedItems: '',
    rejectedItems: '总结复盘, 确认格式',
    manualSubtasks: '',
    siblingTasks: '更新项目文档, 修复线上bug',
  },
  {
    name: '复杂-团建',
    taskTitle: '组织部门团建活动',
    projectName: '行政',
    detailLevel: 'detailed',
    userPatterns: '',
    learnedItems: '预订餐厅, 统计人数',
    rejectedItems: '做好准备工作',
    manualSubtasks: '确定日期, 预算报批, 订大巴',
    siblingTasks: '',
  },
  {
    name: '技术-修bug',
    taskTitle: '修复用户登录页面白屏问题',
    projectName: '前端开发',
    detailLevel: 'normal',
    userPatterns: '',
    learnedItems: '',
    rejectedItems: '',
    manualSubtasks: '复现问题, 查看控制台报错, 检查网络请求',
    siblingTasks: '优化首页加载速度, 重构用户中心组件',
  },
  {
    name: '生活-搬家',
    taskTitle: '下周六搬家到新公寓',
    projectName: '',
    detailLevel: 'detailed',
    userPatterns: '',
    learnedItems: '',
    rejectedItems: '提前规划',
    manualSubtasks: '',
    siblingTasks: '',
  },
  {
    name: '带历史-做PPT',
    taskTitle: '做项目汇报PPT',
    projectName: '工作',
    detailLevel: 'normal',
    userPatterns: '收集数据, 画流程图',
    learnedItems: '写大纲, 找模板, 截关键截图',
    rejectedItems: '确认汇报内容, 准备汇报材料',
    manualSubtasks: '导出本月数据, 画架构图, 排版检查',
    siblingTasks: '写技术方案, 更新Wiki',
  },
];

// ─── Prompt Candidates ───────────────────────────────────────────────

const CANDIDATES = {
  // --- A: Current prompt (v11 baseline) ---
  A: {
    label: 'v11 当前版本',
    system: `You are a task checklist assistant. Suggest short, specific action items.

RULES:
1. INFER task type from title. Study → study actions. Travel → logistics. Work → deliverables.
2. KEEP EACH ITEM VERY SHORT: 2-6 words max. Examples: "携带身份证", "定闹钟", "复习单词", "检查车票", "约见面地点"
3. Only suggest concrete, specific items — NOT vague steps like "做准备", "确认安排"
4. Do NOT suggest meta-tasks: "制定计划", "确认时间", "总结复盘"
5. Count: simple tasks 2-3 items, normal 3-5, detailed 5-8
6. Same language as task title
7. If user history provided, follow their patterns
8. If rejected items provided, avoid similar suggestions

Return JSON only: {"actions": [{"type": "create_subtask", "params": {"title": "..."}}]}`,
    userTemplate: `Task: {{taskTitle}}
Project: {{projectName}}
Detail level: {{detailLevel}}
{{#if userPatterns}}User's typical subtasks for similar tasks: {{userPatterns}}{{/if}}
{{#if learnedItems}}Previously accepted suggestions: {{learnedItems}}{{/if}}
{{#if rejectedItems}}Previously rejected (avoid these): {{rejectedItems}}{{/if}}
{{#if manualSubtasks}}User's manually created subtasks for similar tasks: {{manualSubtasks}}{{/if}}
{{#if siblingTasks}}Other tasks in same project: {{siblingTasks}}{{/if}}`,
  },

  // --- B: 中文 few-shot + 字符数约束 ---
  B: {
    label: '中文 few-shot',
    system: `你是一个任务清单助手。根据任务标题，生成可直接执行的子任务。

【核心规则】
- 每条子任务 ≤ 8个字，是一个具体动作（动词开头）
- 禁止空泛项："做准备""确认安排""制定计划""总结复盘"
- 从标题推断任务类型，给出对应领域的具体动作
- 如有用户历史，优先参考历史习惯
- 如有拒绝记录，避免类似建议

【示例】
任务: 出差去上海 → ["订机票","订酒店","带充电器","查会议室地址"]
任务: 准备期末考试 → ["整理错题本","背重点公式","做两套真题"]
任务: 修复首页白屏bug → ["复现问题","查控制台报错","定位异常组件"]
任务: 周末大扫除 → ["拖地","擦窗户","整理衣柜","倒垃圾"]

仅返回JSON: {"actions": [{"type": "create_subtask", "params": {"title": "..."}}]}`,
    userTemplate: `任务: {{taskTitle}}
{{#if projectName}}项目: {{projectName}}{{/if}}
{{#if userPatterns}}用户常用子任务: {{userPatterns}}{{/if}}
{{#if learnedItems}}用户曾接受: {{learnedItems}}{{/if}}
{{#if rejectedItems}}用户曾拒绝(避免类似): {{rejectedItems}}{{/if}}
{{#if manualSubtasks}}用户曾手动创建: {{manualSubtasks}}{{/if}}
{{#if siblingTasks}}同项目其他任务: {{siblingTasks}}{{/if}}`,
  },

  // --- C: 极简约束 + 对比示范 ---
  C: {
    label: '极简对比法',
    system: `你给任务写待办清单。每条≤8字，动词开头，可直接执行。

❌ 错误: "准备相关材料"  "确认具体安排"  "做好前期准备"  "制定详细计划"
✅ 正确: "订机票"  "带身份证"  "背单词"  "查报错日志"  "拖地"  "买牛奶"

用户历史优先。返回JSON: {"actions": [{"type": "create_subtask", "params": {"title": "..."}}]}`,
    userTemplate: `{{taskTitle}}
{{#if userPatterns}}常用: {{userPatterns}}{{/if}}
{{#if learnedItems}}曾接受: {{learnedItems}}{{/if}}
{{#if rejectedItems}}曾拒绝: {{rejectedItems}}{{/if}}
{{#if manualSubtasks}}曾手动建: {{manualSubtasks}}{{/if}}`,
  },

  // --- D: 结构化 few-shot + 严格字符数 ---
  D: {
    label: '结构化严格版',
    system: `角色: 任务待办清单生成器

【输出格式】JSON: {"actions": [{"type": "create_subtask", "params": {"title": "..."}}]}

【字数】每条标题 3-8 个字
【数量】简单任务 2-3 条，普通 3-5 条，详细 5-7 条
【风格】动词开头，一个具体动作，像便利贴上的一行字

【绝对禁止的表述】
"制定…计划" "确认…安排" "做…准备" "总结…复盘" "了解…情况" "安排…事宜"
任何包含 "相关" "具体" "详细" "合理" "进行" 的表述

【推断规则】从标题推断类别，给该类别的核心动作:
出行 → 交通/住宿/证件/物品
学习 → 练习/背诵/做题/整理笔记
开发 → 复现/定位/修复/测试
家务 → 具体清洁/整理/采购动作
汇报 → 收集数据/画图表/写提纲

【用户适配】有历史数据时参考用户风格，有拒绝记录时避开相似项`,
    userTemplate: `任务: {{taskTitle}}
{{#if projectName}}项目: {{projectName}}{{/if}}
{{#if userPatterns}}>>> 用户常用子任务: {{userPatterns}}{{/if}}
{{#if learnedItems}}>>> 曾接受的建议: {{learnedItems}}{{/if}}
{{#if rejectedItems}}>>> 曾拒绝(回避): {{rejectedItems}}{{/if}}
{{#if manualSubtasks}}>>> 手动创建过: {{manualSubtasks}}{{/if}}
{{#if siblingTasks}}>>> 同项目其他任务: {{siblingTasks}}{{/if}}`,
  },

  // --- E: 混合优化版 (C的极简 + B的few-shot + 数量控制) ---
  E: {
    label: '混合优化版',
    system: `你给任务生成待办清单。

【格式】每条 3-8 字，动词开头，可直接执行
【数量】2-5 条（不多不少）
【重点】有用户历史时，参考用户习惯；有拒绝记录时，避免类似项

❌ 太空泛: "做好准备" "确认安排" "制定计划" "了解情况" "准备材料"
✅ 好的: "订机票" "带身份证" "背单词" "查报错日志" "拖地" "买牛奶"

示例:
出差去上海 → ["订机票","订酒店","带充电器","查会议地址"]
准备期末考试 → ["背重点公式","做两套真题","整理错题本"]
修复首页白屏 → ["复现问题","查控制台报错","定位异常组件"]

仅返回JSON: {"actions": [{"type": "create_subtask", "params": {"title": "..."}}]}`,
    userTemplate: `{{taskTitle}}
{{#if projectName}}[{{projectName}}]{{/if}}
{{#if learnedItems}}参考: {{learnedItems}}{{/if}}
{{#if manualSubtasks}}历史: {{manualSubtasks}}{{/if}}
{{#if rejectedItems}}避免: {{rejectedItems}}{{/if}}
{{#if userPatterns}}常用: {{userPatterns}}{{/if}}`,
  },

  // --- F: 最精炼版 (纯中文，最短 system，强 few-shot) ---
  F: {
    label: '精炼 few-shot',
    system: `生成2-5条待办子任务。每条≤8字，动词开头。参考用户历史，避开拒绝项。
禁用词: "准备""安排""计划""确认""复盘""总结""相关""进行"

输入→输出示例:
去超市买菜 → ["查冰箱缺什么","买菜","买水果","带购物袋"]
准备四级考试 → ["背单词","做真题","练听力","整理错题"]
写周报 → ["列本周完成项","写关键成果","发给主管"]
修登录bug → ["复现问题","查报错日志","修复代码","跑测试"]
组织团建 → ["定日期","订餐厅","统计人数","发通知"]

JSON: {"actions":[{"type":"create_subtask","params":{"title":"..."}}]}`,
    userTemplate: `{{taskTitle}}
{{#if learnedItems}}[曾接受] {{learnedItems}}{{/if}}
{{#if manualSubtasks}}[曾手建] {{manualSubtasks}}{{/if}}
{{#if rejectedItems}}[曾拒绝] {{rejectedItems}}{{/if}}`,
  },
};

// ─── Template Renderer (copy from promptEngine.ts) ───────────────────
function renderPrompt(template, context) {
  let result = template;

  // {{#each key}}...{{/each}}
  result = result.replace(
    /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, key, body) => {
      const value = context[key];
      if (!Array.isArray(value)) return '';
      return value.map((item, index) => {
        let rendered = body;
        if (typeof item === 'object' && item !== null) {
          for (const [k, v] of Object.entries(item)) {
            rendered = rendered.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v ?? ''));
          }
        } else {
          rendered = rendered.replace(/\{\{this\}\}/g, String(item));
        }
        rendered = rendered.replace(/\{\{@index\}\}/g, String(index));
        return rendered;
      }).join('');
    },
  );

  // {{#if key}}...{{/if}}
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, key, body) => {
      const value = context[key];
      if (!value || (Array.isArray(value) && value.length === 0)) return '';
      return body;
    },
  );

  // {{variable}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = context[key];
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });

  return result;
}

// ─── API Call ────────────────────────────────────────────────────────
async function callAI(system, user) {
  const url = apiUrl(ENDPOINT);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = await res.json();
  const content = body.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) throw new Error('Empty response');

  // Extract JSON
  try {
    return JSON.parse(content);
  } catch {
    const first = content.indexOf('{');
    const last = content.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return JSON.parse(content.slice(first, last + 1));
    }
    throw new Error(`Parse failed: ${content.slice(0, 100)}`);
  }
}

// ─── Scoring ─────────────────────────────────────────────────────────
const VAGUE_PATTERNS = [
  /^(做好?|进行|确认|安排|准备|制定|了解|明确|总结|复盘|落实|梳理).{0,2}(准备|安排|计划|工作|事宜|情况|方案|内容)?$/,
  /(相关|具体|详细|合理|充分|必要|适当)/,
  /^.{0,2}(准备|安排|计划|工作|事宜)$/,
];

function scoreActions(actions, scenario) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { total: 0, details: 'NO_ACTIONS', titles: [] };
  }

  const titles = actions
    .map(a => a?.params?.title || a?.title || '')
    .filter(Boolean);

  if (titles.length === 0) {
    return { total: 0, details: 'NO_TITLES', titles: [] };
  }

  let brevityScore = 0;   // 0-30: shorter is better
  let specificScore = 0;   // 0-30: not vague
  let actionScore = 0;     // 0-20: starts with verb
  let countScore = 0;      // 0-10: right number of items
  let historyScore = 0;    // 0-10: respects user history

  // --- Brevity (30 pts) ---
  const avgLen = titles.reduce((s, t) => s + t.length, 0) / titles.length;
  if (avgLen <= 5) brevityScore = 30;
  else if (avgLen <= 8) brevityScore = 25;
  else if (avgLen <= 10) brevityScore = 15;
  else if (avgLen <= 12) brevityScore = 5;
  else brevityScore = 0;

  // --- Specificity (30 pts) ---
  let vagueCount = 0;
  for (const t of titles) {
    if (VAGUE_PATTERNS.some(p => p.test(t))) vagueCount++;
  }
  specificScore = Math.round(30 * (1 - vagueCount / titles.length));

  // --- Action-oriented (20 pts) ---
  // Chinese verbs tend to be the first character; check title doesn't start with noun-like patterns
  const NOUN_STARTS = /^(的|了|和|与|或|及|等|各|每|该|其|本|此)/;
  let actionCount = 0;
  for (const t of titles) {
    if (!NOUN_STARTS.test(t)) actionCount++;
  }
  actionScore = Math.round(20 * (actionCount / titles.length));

  // --- Count appropriateness (10 pts) ---
  const level = scenario.detailLevel || 'normal';
  const [minCount, maxCount] =
    level === 'simple' ? [2, 3] :
    level === 'detailed' ? [5, 8] :
    [3, 5];
  if (titles.length >= minCount && titles.length <= maxCount) {
    countScore = 10;
  } else if (titles.length >= minCount - 1 && titles.length <= maxCount + 1) {
    countScore = 5;
  }

  // --- History respect (10 pts) ---
  if (scenario.rejectedItems) {
    const rejected = scenario.rejectedItems.split(/[,，]/).map(s => s.trim());
    const hasRejected = titles.some(t => rejected.some(r => t.includes(r) || r.includes(t)));
    historyScore += hasRejected ? 0 : 5;
  } else {
    historyScore += 5;
  }
  if (scenario.learnedItems || scenario.manualSubtasks) {
    // Bonus if any suggested item is similar to learned items
    const learned = [
      ...(scenario.learnedItems || '').split(/[,，]/),
      ...(scenario.manualSubtasks || '').split(/[,，]/),
    ].map(s => s.trim()).filter(Boolean);
    const hasSimilar = titles.some(t => learned.some(l =>
      t.includes(l) || l.includes(t) || (t.length > 2 && l.length > 2 && t.slice(0, 2) === l.slice(0, 2))
    ));
    historyScore += hasSimilar ? 5 : 0;
  } else {
    historyScore += 5;
  }

  const total = brevityScore + specificScore + actionScore + countScore + historyScore;

  return {
    total,
    brevity: brevityScore,
    specific: specificScore,
    action: actionScore,
    count: countScore,
    history: historyScore,
    avgLen: avgLen.toFixed(1),
    numItems: titles.length,
    titles,
  };
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🧪 Prompt Evaluation — Model: ${MODEL}, Runs: ${RUNS}`);
  console.log('═'.repeat(80));

  const candidateKeys = ONLY || Object.keys(CANDIDATES);
  const results = {}; // { candidateKey: { scenarioName: [scores] } }

  for (const key of candidateKeys) {
    if (!CANDIDATES[key]) {
      console.error(`Unknown candidate: ${key}`);
      continue;
    }
    results[key] = {};
  }

  // Run tests
  for (const scenario of SCENARIOS) {
    console.log(`\n📋 场景: ${scenario.name} — "${scenario.taskTitle}"`);
    console.log('─'.repeat(60));

    for (const key of candidateKeys) {
      const cand = CANDIDATES[key];
      if (!cand) continue;

      results[key][scenario.name] = [];

      for (let run = 0; run < RUNS; run++) {
        const userPrompt = renderPrompt(cand.userTemplate, scenario);
        try {
          const data = await callAI(cand.system, userPrompt);
          const actions = data.actions || [];
          const score = scoreActions(actions, scenario);
          results[key][scenario.name].push(score);

          const titles = score.titles.map(t => `"${t}"`).join(', ');
          console.log(
            `  [${key}] ${cand.label}: ${score.total}/100  ` +
            `(简${score.brevity} 具${score.specific} 动${score.action} 数${score.count} 史${score.history})  ` +
            `avg=${score.avgLen}字 n=${score.numItems}`
          );
          console.log(`       → ${titles}`);
        } catch (err) {
          console.log(`  [${key}] ${cand.label}: ❌ ${err.message}`);
          results[key][scenario.name].push({ total: 0, error: err.message });
        }
      }
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(80));
  console.log('📊 综合评分对比');
  console.log('═'.repeat(80));
  console.log(
    'Candidate'.padEnd(25) +
    'Avg Score'.padEnd(12) +
    'Brevity'.padEnd(10) +
    'Specific'.padEnd(10) +
    'Action'.padEnd(10) +
    'Count'.padEnd(10) +
    'History'.padEnd(10)
  );
  console.log('─'.repeat(80));

  const summaries = [];
  for (const key of candidateKeys) {
    const cand = CANDIDATES[key];
    if (!cand) continue;

    const allScores = Object.values(results[key]).flat().filter(s => s.total !== undefined);
    if (allScores.length === 0) continue;

    const avg = (field) => {
      const vals = allScores.filter(s => s[field] !== undefined).map(s => s[field]);
      return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    };

    const summary = {
      key,
      label: cand.label,
      avgTotal: avg('total'),
      avgBrevity: avg('brevity'),
      avgSpecific: avg('specific'),
      avgAction: avg('action'),
      avgCount: avg('count'),
      avgHistory: avg('history'),
    };
    summaries.push(summary);

    console.log(
      `[${key}] ${summary.label}`.padEnd(25) +
      summary.avgTotal.toFixed(1).padEnd(12) +
      summary.avgBrevity.toFixed(1).padEnd(10) +
      summary.avgSpecific.toFixed(1).padEnd(10) +
      summary.avgAction.toFixed(1).padEnd(10) +
      summary.avgCount.toFixed(1).padEnd(10) +
      summary.avgHistory.toFixed(1).padEnd(10)
    );
  }

  // Winner
  summaries.sort((a, b) => b.avgTotal - a.avgTotal);
  if (summaries.length > 0) {
    console.log('\n🏆 推荐方案: ' + `[${summaries[0].key}] ${summaries[0].label} — 均分 ${summaries[0].avgTotal.toFixed(1)}/100`);
  }

  // ─── Per-scenario breakdown ──────────────────────────────────────
  console.log('\n\n' + '═'.repeat(80));
  console.log('📋 各场景详细对比');
  console.log('═'.repeat(80));

  for (const scenario of SCENARIOS) {
    console.log(`\n▸ ${scenario.name}: "${scenario.taskTitle}"`);
    for (const key of candidateKeys) {
      const cand = CANDIDATES[key];
      if (!cand) continue;
      const scores = results[key]?.[scenario.name] || [];
      for (const s of scores) {
        if (s.error) {
          console.log(`  [${key}] ❌ ${s.error}`);
        } else {
          console.log(`  [${key}] ${s.total}/100  → ${s.titles.map(t => `"${t}"`).join(', ')}`);
        }
      }
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
