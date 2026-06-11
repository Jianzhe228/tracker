import type { ProjectItem, RecurringRuleItem } from '../../types/domain';
import { invokeCommand } from './invoke';

interface SettingEntry {
  key: string;
  value: string;
}

export interface AppInitData {
  settings: SettingEntry[];
  projects: ProjectItem[];
  recurringRules: RecurringRuleItem[];
}

export function appInit(): Promise<AppInitData> {
  return invokeCommand<AppInitData>('app_init');
}
