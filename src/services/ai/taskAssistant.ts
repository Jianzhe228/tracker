/**
 * Task assistant — thin adapter layer.
 * Pure utility functions (date inference, pomodoro estimation) live here.
 * AI-powered suggestions are handled via the AI queue (see queue.ts / aiStore.ts).
 */

export interface TaskAssistantSuggestion {
  inputTitle: string;
  suggestedSubtasks: string[];
  suggestedDueAt: string | null;
  suggestedPomodoroCount: number;
  reasoning: string;
  source: 'remote' | 'local';
}

export interface TaskAssistantOptions {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  existingTaskTitles?: string[];
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function inferDueAtFromTitle(title: string): string | null {
  const now = new Date();

  if (title.includes('大后天')) {
    const next = new Date(now);
    next.setDate(next.getDate() + 3);
    return toDateInputValue(next);
  }
  if (title.includes('后天')) {
    const next = new Date(now);
    next.setDate(next.getDate() + 2);
    return toDateInputValue(next);
  }
  if (title.includes('明天')) {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    return toDateInputValue(next);
  }
  if (title.includes('今天')) {
    return toDateInputValue(now);
  }

  // "X月X日"
  const monthDay = /(\d{1,2})月(\d{1,2})[日号]?/.exec(title);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    const year = now.getFullYear();
    const date = new Date(year, month - 1, day);
    if (date.getMonth() === month - 1 && date.getDate() === day) {
      const dateValue = toDateInputValue(date);
      if (dateValue < toDateInputValue(now)) {
        const nextYear = new Date(year + 1, month - 1, day);
        return toDateInputValue(nextYear);
      }
      return dateValue;
    }
  }

  return null;
}

export function estimatePomodoros(subtaskCount: number, title: string): number {
  const base = Math.max(1, Math.ceil(subtaskCount / 2));
  if (/(汇报|方案|需求|设计|复盘|面试|考试|出差|旅行|搬家)/.test(title)) {
    return Math.min(6, Math.max(2, base + 1));
  }
  return Math.min(5, base);
}

/**
 * Build a local-only suggestion (date inference only, no subtask generation).
 * Subtask generation is now handled via AI queue.
 */
export function buildLocalTaskSuggestion(
  rawTitle: string,
  _existingTaskTitles: string[] = [],
): TaskAssistantSuggestion {
  const title = normalizeTitle(rawTitle);
  const dueAt = inferDueAtFromTitle(title);
  return {
    inputTitle: title,
    suggestedSubtasks: [],
    suggestedDueAt: dueAt,
    suggestedPomodoroCount: 1,
    reasoning: dueAt ? 'Inferred due date from title' : 'No clear pattern detected',
    source: 'local',
  };
}

/**
 * @deprecated Use aiStore.submitJob('task_decompose', context) for AI-powered suggestions.
 * This function now only returns local date inference.
 */
export async function buildTaskSuggestion(
  rawTitle: string,
  options: TaskAssistantOptions = {},
): Promise<TaskAssistantSuggestion> {
  return buildLocalTaskSuggestion(rawTitle, options.existingTaskTitles);
}
