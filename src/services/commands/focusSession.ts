import { invokeCommand } from './invoke';

import type { FocusSession, FocusSessionStats, ProjectTimeStat } from '../../types/domain';

export interface FocusSessionCreatePayload {
  taskId: number | null;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  type: string;
  status: string;
  interruptionReason?: string;
  pomodoroCount?: number;
  segments?: Array<{
    taskId: number | null;
    startTime: string;
    durationSeconds: number;
    sortOrder: number;
  }>;
}

export function createFocusSession(payload: FocusSessionCreatePayload): Promise<FocusSession> {
  return invokeCommand<FocusSession>('focus_session_create', { payload });
}

export function listFocusSessions(options?: {
  fromDate?: string;
  toDate?: string;
  limit?: number;
}): Promise<FocusSession[]> {
  return invokeCommand<FocusSession[]>('focus_session_list', options);
}

export function getFocusSessionStats(fromDate: string, toDate: string): Promise<FocusSessionStats> {
  return invokeCommand<FocusSessionStats>('focus_session_stats', { fromDate, toDate });
}

export function getProjectDistribution(fromDate: string, toDate: string): Promise<ProjectTimeStat[]> {
  return invokeCommand<ProjectTimeStat[]>('focus_session_project_distribution', { fromDate, toDate });
}
