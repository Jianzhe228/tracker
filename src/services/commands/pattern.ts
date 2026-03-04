import { invokeCommand } from './invoke';
import type { SubtaskPattern } from '../../types/domain';

export function patternList(projectId?: number): Promise<SubtaskPattern[]> {
  return invokeCommand<SubtaskPattern[]>('pattern_list', { projectId: projectId ?? null });
}

export function patternCreate(payload: {
  name: string;
  keywords: string[];
  subtasks: string[];
  projectId?: number | null;
}): Promise<SubtaskPattern> {
  return invokeCommand<SubtaskPattern>('pattern_create', {
    payload: {
      name: payload.name,
      keywords: payload.keywords,
      subtasks: payload.subtasks,
      projectId: payload.projectId ?? null,
    },
  });
}

export function patternUpdate(
  id: number,
  payload: {
    name?: string;
    keywords?: string[];
    subtasks?: string[];
    projectId?: number | null;
  },
): Promise<void> {
  return invokeCommand<void>('pattern_update', { id, payload });
}

export function patternDelete(id: number): Promise<void> {
  return invokeCommand<void>('pattern_delete', { id });
}

export function patternMatch(
  keywords: string[],
  projectId?: number | null,
): Promise<SubtaskPattern[]> {
  return invokeCommand<SubtaskPattern[]>('pattern_match', {
    keywords,
    projectId: projectId ?? null,
  });
}
