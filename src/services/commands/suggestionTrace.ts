/**
 * Frontend commands for suggestion trace persistence.
 */
import { invokeCommand } from './invoke';

export function suggestionRunCreate(payload: {
  taskId: number;
  taskTitle: string;
  projectId: number | null;
  analysisJson: string;
  strategy: string;
}): Promise<number> {
  return invokeCommand<number>('suggestion_run_create', {
    taskId: payload.taskId,
    taskTitle: payload.taskTitle,
    projectId: payload.projectId,
    analysisJson: payload.analysisJson,
    strategy: payload.strategy,
  });
}

export function suggestionCandidateInsert(payload: {
  runId: number;
  title: string;
  source: string;
  mergedSourcesJson: string;
  score: number;
  evidenceJson: string;
  reasonsJson: string;
  shownRank: number | null;
}): Promise<number> {
  return invokeCommand<number>('suggestion_candidate_insert', {
    runId: payload.runId,
    title: payload.title,
    source: payload.source,
    mergedSourcesJson: payload.mergedSourcesJson,
    score: payload.score,
    evidenceJson: payload.evidenceJson,
    reasonsJson: payload.reasonsJson,
    shownRank: payload.shownRank,
  });
}

export function suggestionCandidateMarkSelected(candidateId: number): Promise<void> {
  return invokeCommand<void>('suggestion_candidate_mark_selected', {
    candidateId,
  });
}

export function suggestionCandidateMarkRejected(candidateId: number): Promise<void> {
  return invokeCommand<void>('suggestion_candidate_mark_rejected', {
    candidateId,
  });
}
