import { invokeCommand } from './invoke';
import type {
  HistoryTemplateNode,
  KeywordCluster,
  LearnStats,
  LearnSuggestion,
  SuggestionFeedbackPayload,
} from '../../types/domain';

export function learnRecord(
  keyword: string,
  subtaskTitle: string,
  projectId: number | null,
  delta: number,
  source?: string,
): Promise<void> {
  return invokeCommand<void>('learn_record', {
    keyword,
    subtaskTitle,
    projectId,
    delta,
    source: source ?? null,
  });
}

export function learnRecordBatch(
  keywords: string[],
  subtaskTitle: string,
  projectId: number | null,
  delta: number,
  source?: string,
): Promise<void> {
  return invokeCommand<void>('learn_record_batch', {
    keywords,
    subtaskTitle,
    projectId,
    delta,
    source: source ?? null,
  });
}

export function learnSuggest(
  keywords: string[],
  projectId: number | null,
  limit?: number,
): Promise<LearnSuggestion[]> {
  return invokeCommand<LearnSuggestion[]>('learn_suggest', {
    keywords,
    projectId,
    limit: limit ?? null,
  });
}

export function clusterList(): Promise<KeywordCluster[]> {
  return invokeCommand<KeywordCluster[]>('cluster_list');
}

export function clusterUpsert(
  id: number | null,
  name: string,
  keywords: string[],
  confirmed?: number,
): Promise<KeywordCluster> {
  return invokeCommand<KeywordCluster>('cluster_upsert', {
    id,
    name,
    keywords,
    confirmed: confirmed ?? null,
  });
}

export function clusterDelete(id: number): Promise<void> {
  return invokeCommand<void>('cluster_delete', { id });
}

// ── New self-learning commands ──────────────────────────────────────

export function learnStats(
  keywords: string[],
  projectId: number | null,
): Promise<LearnStats> {
  return invokeCommand<LearnStats>('learn_stats', { keywords, projectId });
}

export function learnKnownKeywords(): Promise<string[]> {
  return invokeCommand<string[]>('learn_known_keywords');
}

export function historySuggest(
  keywords: string[],
  projectId: number | null,
  limit?: number,
): Promise<string[]> {
  return invokeCommand<string[]>('history_suggest', {
    keywords,
    projectId,
    limit: limit ?? null,
  });
}

export function historyGetTemplate(
  taskTitle: string,
  keywords: string[],
  projectId: number | null,
  maxDepth = 2,
): Promise<HistoryTemplateNode[]> {
  return invokeCommand<HistoryTemplateNode[]>('history_get_template', {
    taskTitle,
    keywords,
    projectId,
    maxDepth,
  });
}

export function feedbackRecord(payload: SuggestionFeedbackPayload): Promise<void> {
  return invokeCommand<void>('feedback_record', { payload });
}

export function feedbackRejectedTitles(
  keywords: string[],
  projectId: number | null,
): Promise<string[]> {
  return invokeCommand<string[]>('feedback_rejected_titles', { keywords, projectId });
}
