import type { TaskItem, ProjectItem, RecurringRuleItem } from '../../types/domain';
import { invokeCommand } from './invoke';

interface SettingEntry {
  key: string;
  value: string;
}

export interface AppInitData {
  tasks: TaskItem[];
  settings: SettingEntry[];
  projects: ProjectItem[];
  recurringRules: RecurringRuleItem[];
}

export function appInit(): Promise<AppInitData> {
  return invokeCommand<AppInitData>('app_init');
}

export interface TaskInitResult {
  tasks: TaskItem[];
  totalCount: number;
}

export function taskListInit(offset?: number, limit?: number): Promise<TaskInitResult> {
  return invokeCommand<TaskInitResult>('task_list_init', { offset, limit });
}
