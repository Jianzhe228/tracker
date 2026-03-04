/**
 * Chinese + English keyword extractor for task titles.
 * Uses a built-in dictionary approach for Chinese (no external NLP lib).
 */

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

// Dictionary of known domain keywords to detect in Chinese text (compound words)
const KEYWORD_DICT: string[] = [
  // Sports & fitness
  '健身', '锻炼', '运动', '跑步', '游泳', '瑜伽', '篮球', '足球',
  '羽毛球', '乒乓球', '网球', '骑行', '爬山', '登山', '徒步', '散步',
  '举铁', '拳击', '太极', '武术',
  // Travel & commute
  '出差', '出行', '出门', '旅行', '旅游', '外出', '回家', '拜年',
  '搬家', '搬迁', '接机', '送机', '自驾',
  // Work & meeting
  '会议', '开会', '汇报', '述职', '演讲', '培训', '面试', '求职',
  '应聘', '谈判', '签约', '答辩', '考核', '复盘',
  // Study & exam
  '考试', '笔试', '面试', '测验', '考研', '考公', '考证', '学习',
  '复习', '预习', '上课', '讲座', '研讨',
  // Shopping & errands
  '购物', '买菜', '超市', '商场', '网购', '快递', '取件',
  '办事', '银行', '医院', '政务', '社保', '公积金', '办证',
  // Life
  '做饭', '烹饪', '打扫', '清洁', '洗衣', '整理', '收纳',
  '聚餐', '聚会', '生日', '婚礼', '约会', '看病', '体检',
  // Tech
  '编程', '开发', '部署', '上线', '发布', '测试', '调试',
  '代码', '设计', '需求', '方案', '文档', '写作',
  // Project types
  '项目', '报告', '论文', 'PPT', '简历', '邮件',
];

/**
 * Extract meaningful keywords from a task title.
 * Returns an array of keywords (deduplicated, lowercased for English).
 */
export function extractKeywords(title: string): string[] {
  const normalized = title.trim();
  if (!normalized) return [];

  const keywords: Set<string> = new Set();

  // 1. Match known dictionary words (longest match first)
  const sortedDict = [...KEYWORD_DICT].sort((a, b) => b.length - a.length);
  let remaining = normalized;
  for (const word of sortedDict) {
    if (remaining.includes(word)) {
      keywords.add(word);
      // Don't remove from remaining — allow overlapping matches
    }
  }

  // 2. Extract English words (2+ chars, not stop words)
  const englishWords = normalized.match(/[a-zA-Z]{2,}/g);
  if (englishWords) {
    for (const w of englishWords) {
      const lower = w.toLowerCase();
      if (!STOP_WORDS.has(lower)) {
        keywords.add(lower);
      }
    }
  }

  // 3. Extract remaining Chinese characters as individual tokens (fallback)
  //    Only if no dictionary matches found
  if (keywords.size === 0) {
    // Split by non-Chinese characters, then extract 2-char bigrams
    const chineseChars = normalized.replace(/[^\u4e00-\u9fff]/g, '');
    if (chineseChars.length >= 2) {
      for (let i = 0; i < chineseChars.length - 1; i++) {
        const bigram = chineseChars.slice(i, i + 2);
        if (!STOP_WORDS.has(bigram)) {
          keywords.add(bigram);
        }
      }
    } else if (chineseChars.length === 1 && !STOP_WORDS.has(chineseChars)) {
      keywords.add(chineseChars);
    }
  }

  return [...keywords];
}
