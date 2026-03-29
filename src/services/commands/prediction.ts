import { invokeCommand } from './invoke';

export interface TaskCreationHistoryRow {
  id: number;
  taskTitle: string;
  projectId: number | null;
  createdAt: string;
  dow: string | null;
  hour: number | null;
  dayOfMonth: number | null;
  isRecurringInstance: boolean;
}

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

export interface PredictionSavePayload {
  title: string;
  reason?: string | null;
  projectId?: number | null;
  titleKey?: string | null;
  score?: number | null;
  scoreBreakdown?: string | null;
  algorithmVersion?: string | null;
}

export interface PredictionAnalysisContext {
  currentTime: string;
  dayOfWeek: string;
  days: number;
  count: number;
  taskList: string;
  recentProjects: string | null;
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

export function getTaskCreationHistory(days?: number): Promise<TaskCreationHistoryRow[]> {
  return invokeCommand<TaskCreationHistoryRow[]>('get_task_creation_history', { days });
}

export function getPredictionAnalysisContext(days?: number): Promise<PredictionAnalysisContext> {
  return invokeCommand<PredictionAnalysisContext>('get_prediction_analysis_context', { days });
}

export function refreshPredictions(force = false): Promise<PredictionRefreshResult> {
  return invokeCommand<PredictionRefreshResult>('refresh_predictions', { force });
}

export function savePredictions(
  predictions: PredictionSavePayload[],
  aiContext?: string | null,
  sourceJobId?: number | null
): Promise<number[]> {
  return invokeCommand<number[]>('save_predictions', {
    predictions,
    aiContext: aiContext ?? null,
    sourceJobId: sourceJobId ?? null,
  });
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

export function cleanupExpiredPredictions(days?: number): Promise<number> {
  return invokeCommand<number>('cleanup_expired_predictions', { days });
}
