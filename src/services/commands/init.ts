import type { TaskItem, HabitItem, ProjectItem } from '../../types/domain';
import { invokeCommand } from './invoke';

interface SettingEntry {
  key: string;
  value: string;
}

export interface AppInitData {
  tasks: TaskItem[];
  habits: HabitItem[];
  settings: SettingEntry[];
  projects: ProjectItem[];
}

export function appInit(): Promise<AppInitData> {
  return invokeCommand<AppInitData>('app_init');
}
