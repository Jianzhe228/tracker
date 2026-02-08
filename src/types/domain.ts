export type TaskStatus = 'todo' | 'done';

export interface TaskSubItem {
  id: number;
  title: string;
  done: boolean;
}

export interface TaskItem {
  id: number;
  title: string;
  status: TaskStatus;
  pomodoroCount: number;
  dueDate: string | null;
  listId: string;
  reminderAt: string | null;
  notes: string;
  subtasks: TaskSubItem[];
  createdAt: string;
  updatedAt: string;
}

export interface HabitItem {
  id: number;
  name: string;
  checkedToday: boolean;
}

export interface PomodoroSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
}
