import { invokeCommand } from './invoke';
import type { RecurringRuleItem } from '../../types/domain';

export interface RuleCreatePayload {
  title: string;
  description?: string | null;
  priority?: number;
  projectId?: number | null;
  repeatType: string;
  repeatDays?: string | null;
  anchorDate: string;
  reminderTime?: string | null;
  notes?: string | null;
  pomodoroCount?: number;
  pomodoroDuration?: number;
}

export interface RuleUpdatePayload {
  id: number;
  title?: string;
  description?: string | null;
  priority?: number;
  projectId?: number | null;
  repeatType?: string;
  repeatDays?: string | null;
  anchorDate?: string;
  reminderTime?: string | null;
  notes?: string | null;
  pomodoroCount?: number;
  pomodoroDuration?: number;
}

export function createRecurringRule(payload: RuleCreatePayload): Promise<RecurringRuleItem> {
  return invokeCommand<RecurringRuleItem>('recurring_rule_create', { payload });
}

export function updateRecurringRule(payload: RuleUpdatePayload): Promise<void> {
  return invokeCommand<void>('recurring_rule_update', { payload });
}

export function deactivateRecurringRule(id: number): Promise<void> {
  return invokeCommand<void>('recurring_rule_deactivate', { id });
}
