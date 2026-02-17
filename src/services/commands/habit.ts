import type { HabitItem } from '../../types/domain';
import { invokeCommand } from './invoke';

interface HabitCreatePayload {
  id: number;
  title: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  type?: string;
  targetValue?: number;
  targetUnit?: string | null;
  frequencyType?: string;
  frequencyValue?: number | null;
  frequencyDays?: string | null;
}

export function listHabits(): Promise<HabitItem[]> {
  return invokeCommand<HabitItem[]>('habit_list');
}

export function createHabit(payload: HabitCreatePayload): Promise<HabitItem> {
  return invokeCommand<HabitItem>('habit_create', { payload });
}

export function toggleHabitCheck(id: number): Promise<boolean> {
  return invokeCommand<boolean>('habit_toggle_check', { id });
}

export function deleteHabit(id: number): Promise<void> {
  return invokeCommand<void>('habit_delete', { id });
}
