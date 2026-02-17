import type { ProjectItem } from '../../types/domain';
import { invokeCommand } from './invoke';

export function listProjects(): Promise<ProjectItem[]> {
  return invokeCommand<ProjectItem[]>('project_list');
}

export function createProject(payload: { title: string; color?: string | null; icon?: string | null; parentId?: number | null }): Promise<ProjectItem> {
  return invokeCommand<ProjectItem>('project_create', { payload });
}

export function updateProject(payload: { id: number; title?: string; color?: string | null; icon?: string | null; parentId?: number | null }): Promise<void> {
  return invokeCommand<void>('project_update', { payload });
}

export function deleteProject(id: number): Promise<void> {
  return invokeCommand<void>('project_delete', { id });
}
