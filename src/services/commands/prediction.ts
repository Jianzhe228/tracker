import { invokeCommand } from './invoke';

export interface PendingPredictionRow {
  id: number;
  title: string;
  reason: string | null;
  predictedForDate: string | null;
  createdAt: string | null;
  notifiedAt: string | null;
  status: string;
  aiContext: string | null;
  sourceJobId: number | null;
  projectId: number | null;
  titleKey: string | null;
  score: number | null;
  scoreBreakdown: string | null;
  algorithmVersion: string | null;
}

export interface PredictionStats {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  historyCount: number;
}

export interface PredictionRefreshResult {
  createdCount: number;
  skipped: boolean;
}

export function recordTaskCreation(payload: {
  taskTitle: string;
  projectId?: number | null;
  createdAt: string;
  isRecurringInstance?: boolean;
}): Promise<number> {
  return invokeCommand<number>('record_task_creation', { payload });
}

export function refreshPredictions(force = false): Promise<PredictionRefreshResult> {
  return invokeCommand<PredictionRefreshResult>('refresh_predictions', { force });
}

export function getPendingPredictions(limit?: number): Promise<PendingPredictionRow[]> {
  return invokeCommand<PendingPredictionRow[]>('get_pending_predictions', { limit });
}

export function updatePredictionStatus(id: number, status: string): Promise<void> {
  return invokeCommand<void>('update_prediction_status', { id, status });
}

export function getPredictionStats(): Promise<PredictionStats> {
  return invokeCommand<PredictionStats>('get_prediction_stats');
}

export function getRecentNotificationKeys(hours = 24): Promise<string[]> {
  return invokeCommand<string[]>('get_recent_notification_keys', { hours });
}
