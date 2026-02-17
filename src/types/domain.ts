export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type Priority = 0 | 1 | 2 | 3;

export interface TaskItem {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  projectId: number | null;
  parentId: number | null;
  dueAt: string | null;
  reminderTime: string | null;
  completedAt: string | null;
  deletedAt: string | null;
  isRecurring: boolean;
  repeatRule: string | null;
  notes: string | null;
  pomodoroCount: number;
  pomodoroDuration: number;
  sortOrder: number;
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

export interface HabitItem {
  id: number;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  type: string;
  targetValue: number;
  targetUnit: string | null;
  frequencyType: string;
  frequencyValue: number | null;
  frequencyDays: string | null;
  maxSkipsPerMonth: number;
  reminderEnabled: boolean;
  reminderTime: string | null;
  archived: boolean;
  checkedToday: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PomodoroSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
}
