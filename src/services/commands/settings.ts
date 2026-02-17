import { invokeCommand } from './invoke';

interface SettingEntry {
  key: string;
  value: string;
}

export function getAllSettings(): Promise<SettingEntry[]> {
  return invokeCommand<SettingEntry[]>('settings_get_all');
}

export function setSetting(key: string, value: string): Promise<void> {
  return invokeCommand<void>('settings_set', { key, value });
}
