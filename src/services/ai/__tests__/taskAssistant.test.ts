/**
 * Tests for taskAssistant utilities.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { inferDueAtFromTitle, estimatePomodoros, buildLocalTaskSuggestion } from '../taskAssistant';

describe('inferDueAtFromTitle', () => {
  let realDateNow: Date['now'];
  const mockDate = new Date('2026-03-23T10:00:00Z');

  beforeEach(() => {
    // Mock Date.now() to return consistent date
    realDateNow = Date.now;
    Date.now = () => mockDate.getTime();
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  it('returns today date for "今天"', () => {
    expect(inferDueAtFromTitle('今天做完')).toBe('2026-03-23');
  });

  it('returns tomorrow date for "明天"', () => {
    expect(inferDueAtFromTitle('明天开会')).toBe('2026-03-24');
  });

  it('returns day after tomorrow for "后天"', () => {
    expect(inferDueAtFromTitle('后天交报告')).toBe('2026-03-25');
  });

  it('returns +3 days for "大后天"', () => {
    expect(inferDueAtFromTitle('大后天出差')).toBe('2026-03-26');
  });

  it('parses "X月X日" format', () => {
    expect(inferDueAtFromTitle('3月25日截止')).toBe('2026-03-25');
  });

  it('parses "X月X号" format', () => {
    expect(inferDueAtFromTitle('3月25号截止')).toBe('2026-03-25');
  });

  it('parses single digit month and day', () => {
    // Jan 5 is before Mar 23, so it rolls to next year
    expect(inferDueAtFromTitle('1月5日')).toBe('2027-01-05');
    // A future month/day should stay in current year
    expect(inferDueAtFromTitle('5月1日')).toBe('2026-05-01');
  });

  it('handles date in the past by using next year', () => {
    expect(inferDueAtFromTitle('1月1日')).toBe('2027-01-01');
  });

  it('returns null for title without date keywords', () => {
    expect(inferDueAtFromTitle('写代码')).toBeNull();
  });

  it('prioritizes "大后天" over "后天" (no false match)', () => {
    // "大后天" contains "后天" as substring but should match the longer one
    expect(inferDueAtFromTitle('大后天去旅行')).toBe('2026-03-26');
  });

  it('prioritizes "后天" over "明天"', () => {
    expect(inferDueAtFromTitle('后天交')).toBe('2026-03-25');
  });

  it('handles month-day with invalid date gracefully', () => {
    // Feb 30 doesn't exist, should return null
    expect(inferDueAtFromTitle('2月30日')).toBeNull();
  });

  it('handles "今天" with other text', () => {
    expect(inferDueAtFromTitle('今天下午要开会')).toBe('2026-03-23');
  });

  it('handles year boundary (Dec 31 should be next year)', () => {
    const dec31 = new Date('2026-12-31T10:00:00Z');
    Date.now = () => dec31.getTime();
    expect(inferDueAtFromTitle('1月1日')).toBe('2027-01-01');
  });
});

describe('estimatePomodoros', () => {
  it('returns 1 for zero subtasks', () => {
    expect(estimatePomodoros(0, 'task')).toBe(1);
  });

  it('returns ceil(subtasks / 2) for normal task', () => {
    expect(estimatePomodoros(1, 'task')).toBe(1);
    expect(estimatePomodoros(2, 'task')).toBe(1);
    expect(estimatePomodoros(3, 'task')).toBe(2);
    expect(estimatePomodoros(4, 'task')).toBe(2);
    expect(estimatePomodoros(5, 'task')).toBe(3);
  });

  it('caps at 5 for normal tasks', () => {
    expect(estimatePomodoros(10, 'task')).toBe(5);
    expect(estimatePomodoros(20, 'task')).toBe(5);
  });

  it('adds +1 for "汇报" keyword with min 2', () => {
    expect(estimatePomodoros(2, '写汇报')).toBe(2); // ceil(2/2)+1 = 2 (min)
    expect(estimatePomodoros(4, '写汇报')).toBe(3); // ceil(4/2)+1 = 3
    expect(estimatePomodoros(10, '写汇报')).toBe(6); // min(6, max(2, ceil(10/2)+1)) = min(6, 6) = 6
  });

  it('adds +1 for "方案" keyword', () => {
    expect(estimatePomodoros(2, '设计方案')).toBe(2);
    expect(estimatePomodoros(4, '设计方案')).toBe(3);
  });

  it('adds +1 for "需求" keyword', () => {
    expect(estimatePomodoros(4, '写需求')).toBe(3);
  });

  it('adds +1 for "设计" keyword', () => {
    expect(estimatePomodoros(4, 'UI设计')).toBe(3);
  });

  it('adds +1 for "复盘" keyword', () => {
    expect(estimatePomodoros(2, '周复盘')).toBe(2);
  });

  it('adds +1 for "面试" keyword', () => {
    expect(estimatePomodoros(1, '面试准备')).toBe(2);
  });

  it('adds +1 for "考试" keyword', () => {
    expect(estimatePomodoros(2, '准备考试')).toBe(2);
  });

  it('adds +1 for "出差" keyword', () => {
    expect(estimatePomodoros(2, '出差安排')).toBe(2);
  });

  it('adds +1 for "旅行" keyword', () => {
    expect(estimatePomodoros(2, '旅行计划')).toBe(2);
  });

  it('adds +1 for "搬家" keyword', () => {
    expect(estimatePomodoros(2, '搬家准备')).toBe(2);
  });

  it('caps at 6 for high-value tasks', () => {
    expect(estimatePomodoros(10, '写汇报')).toBe(6);
    expect(estimatePomodoros(20, '设计方案')).toBe(6);
  });

  it('handles case where title contains multiple keywords', () => {
    // Should only add +1 once, not multiple times
    expect(estimatePomodoros(4, '写汇报和设计方案')).toBe(3);
  });

  it('normal title with many subtasks caps at 5', () => {
    expect(estimatePomodoros(100, '日常任务')).toBe(5);
  });

  it('high-value title with many subtasks caps at 6', () => {
    expect(estimatePomodoros(100, '项目汇报')).toBe(6);
  });
});

describe('buildLocalTaskSuggestion', () => {
  it('normalizes title whitespace', () => {
    const result = buildLocalTaskSuggestion('  task   with   spaces  ');
    expect(result.inputTitle).toBe('task with spaces');
  });

  it('trims title', () => {
    const result = buildLocalTaskSuggestion('  task  ');
    expect(result.inputTitle).toBe('task');
  });

  it('infers due date from title', () => {
    let realDateNow = Date.now;
    Date.now = () => new Date('2026-03-23').getTime();

    const result = buildLocalTaskSuggestion('明天开会');
    expect(result.suggestedDueAt).toBe('2026-03-24');

    Date.now = realDateNow;
  });

  it('returns null due date when no pattern', () => {
    const result = buildLocalTaskSuggestion('写代码');
    expect(result.suggestedDueAt).toBeNull();
  });

  it('returns empty suggestedSubtasks (local only)', () => {
    const result = buildLocalTaskSuggestion('task');
    expect(result.suggestedSubtasks).toEqual([]);
  });

  it('returns suggestedPomodoroCount of 1', () => {
    const result = buildLocalTaskSuggestion('task');
    expect(result.suggestedPomodoroCount).toBe(1);
  });

  it('sets source to local', () => {
    const result = buildLocalTaskSuggestion('task');
    expect(result.source).toBe('local');
  });

  it('provides reasoning when date inferred', () => {
    let realDateNow = Date.now;
    Date.now = () => new Date('2026-03-23').getTime();

    const result = buildLocalTaskSuggestion('明天开会');
    expect(result.reasoning).toBe('Inferred due date from title');

    Date.now = realDateNow;
  });

  it('provides reasoning when no pattern detected', () => {
    const result = buildLocalTaskSuggestion('写代码');
    expect(result.reasoning).toBe('No clear pattern detected');
  });

  it('ignores existingTaskTitles parameter (deprecated)', () => {
    const result = buildLocalTaskSuggestion('task', ['existing1', 'existing2']);
    // Parameter is ignored in current implementation
    expect(result.suggestedSubtasks).toEqual([]);
  });

  it('handles empty title', () => {
    const result = buildLocalTaskSuggestion('');
    expect(result.inputTitle).toBe('');
    expect(result.suggestedDueAt).toBeNull();
  });
});
