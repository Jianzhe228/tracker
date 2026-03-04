import { invokeCommand } from './invoke';
import type { LearnSuggestion, KeywordCluster } from '../../types/domain';

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
