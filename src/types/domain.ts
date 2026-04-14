export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type Priority = 0 | 1 | 2 | 3;

export interface TaskItem {
  id: number;
  title: string;
  status: TaskStatus;
  priority: Priority;
  projectId: number | null;
  parentId: number | null;
  dueAt: string | null;
  startAt: string | null;
  reminderTime: string | null;
  completedAt: string | null;
  deletedAt: string | null;
  notes: string | null;
  pomodoroCount: number;
  pomodoroDuration: number;
  sortOrder: number;
  recurringRuleId: number | null;
  rescheduledTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectItem {
  id: number;
  title: string;
  color: string | null;
  icon: string | null;
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimerSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  autoStartBreak: boolean;
  autoStartNext: boolean;
  defaultTimerKind: 'countdown' | 'countup';
}

export interface RecurringRuleItem {
  id: number;
  title: string;
  description: string | null;
  priority: number;
  projectId: number | null;
  repeatType: string;
  repeatDays: string | null;
  anchorDate: string;
  reminderTime: string | null;
  notes: string | null;
  pomodoroCount: number;
  pomodoroDuration: number;
  active: boolean;
  lastGeneratedDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FocusSession {
  id: number;
  taskId: number | null;
  startTime: string;
  endTime: string | null;
  durationSeconds: number;
  type: string;
  status: string;
  interruptionReason: string | null;
  pomodoroCount: number;
  createdAt: string;
}

export interface FocusSessionSegment {
  id: number;
  sessionId: number;
  taskId: number | null;
  startTime: string;
  durationSeconds: number;
  sortOrder: number;
  createdAt: string;
}

export interface NotificationSettings {
  notifyFocusStart: boolean;
  notifyFocusEnd: boolean;
  notifyBreakEnd: boolean;
  notifyDeadline: boolean;
}

export interface NotificationLogItem {
  id: number;
  type: string;
  title: string;
  body: string;
  payload: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface HourlyBucket {
  hour: number;
  totalSeconds: number;
  sessionCount: number;
}

export interface DailyTotal {
  date: string;
  totalSeconds: number;
  pomodoroCount: number;
  sessionCount: number;
}

export interface FocusSessionStats {
  totalFocusSeconds: number;
  totalPomodoros: number;
  sessionCount: number;
  hourlyDistribution: HourlyBucket[];
  dailyTotals: DailyTotal[];
}

export interface ProjectTimeStat {
  projectId: number | null;
  projectTitle: string;
  totalSeconds: number;
  sessionCount: number;
}

export interface HeatmapEntry {
  date: string;
  focusSeconds: number;
  taskCount: number;
  pomodoroCount: number;
}

export interface DayHourDistributionEntry {
  date: string;
  hour: number;
  totalSeconds: number;
  sessionCount: number;
  pomodoroCount: number;
}

export interface TaskCompletionStats {
  total: number;
  done: number;
  todo: number;
  cancelled: number;
  overdue: number;
}

export interface PeriodStats {
  focusSeconds: number;
  pomodoros: number;
  tasksCompleted: number;
}

export interface StatsOverview {
  today: PeriodStats;
  week: PeriodStats;
  total: PeriodStats;
}

export interface EstimationComparison {
  taskId: number;
  taskTitle: string;
  estimatedSeconds: number;
  actualSeconds: number;
  deviationPercentage: number;
  completedAt: string;
}

export interface WeeklyFocusStat {
  weekStart: string;
  totalSeconds: number;
  sessionCount: number;
  pomodoroCount: number;
}

export interface WeeklyTaskVelocity {
  weekStart: string;
  completedCount: number;
}

export interface ExportResult {
  path: string;
  sizeBytes: number;
}

export interface SyncStatusResult {
  lastSyncAt: string | null;
}

// AI dispatch architecture types (canonical definitions in services/ai/types.ts)
export type { AiSkill, AiJob, AiAction } from '../services/ai/types';

// ── Subtask Pattern (template library) ──────────────────────────────

export interface SubtaskPattern {
  id: number;
  name: string;
  keywords: string[];
  subtasks: string[];
  projectId: number | null;
  isBuiltin: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Learn suggestion ────────────────────────────────────────────────

export interface LearnSuggestion {
  title: string;
  score: number;
  lastUsedAt: string;
}

// ── Learn stats (for confidence scoring) ────────────────────────────

export interface LearnStats {
  matchCount: number;
  maxScore: number;
  totalFeedback: number;
  historyCount: number;
}

export interface HistoryTemplateNode {
  title: string;
  children: HistoryTemplateNode[];
}

// ── Suggestion feedback ─────────────────────────────────────────────

export interface SuggestionFeedbackPayload {
  taskId: number;
  taskTitle: string;
  projectId: number | null;
  suggestionTitle: string;
  source: string;
  action: string;
  jobId?: number | null;
}

// ── Keyword cluster ─────────────────────────────────────────────────

export interface KeywordCluster {
  id: number;
  name: string;
  keywords: string[];
  confirmed: number;
  createdAt: string;
  updatedAt: string;
}

// ── Suggestion pipeline result ──────────────────────────────────────

export type SuggestionSource = 'pattern' | 'learning' | 'ai' | 'none';

export interface SuggestionResult {
  source: SuggestionSource;
  suggestions: string[];
  patternName?: string;
}

// ── Suggestion Harness types ──────────────────────────────────────

export interface TitleAnalysis {
  rawTitle: string;
  normalizedTitle: string;
  keywords: string[];
  intentHints: string[];
  entityHints: string[];
  timeHints: string[];
  englishTerms: string[];
  segmentTrace: Array<{
    text: string;
    type: 'content' | 'temporal' | 'run' | 'english' | 'noise';
    source: 'segmenter' | 'recovery' | 'join' | 'fallback';
  }>;
}

export interface SuggestionCandidate {
  title: string;
  sources: Array<'pattern' | 'learning' | 'history' | 'sibling' | 'ai_generated'>;
  evidence: string[];
  rawScore?: number;
  children?: HistoryTemplateNode[];
}

export interface RankedSuggestion {
  title: string;
  score: number;
  sources: string[];
  evidence: string[];
  reasons: string[];
  children?: HistoryTemplateNode[];
}
