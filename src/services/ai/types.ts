// AI dispatch architecture types — mirrors Rust/DB schema

export interface AiSkill {
  id: number;
  key: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
  actionTypes: string[];
  triggerType: 'manual' | 'on_task_create' | 'on_focus_end' | 'scheduled';
  isBuiltin: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiAction {
  type: string;
  params: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
}

export interface AiJob {
  id: number;
  skillId: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  inputContext: Record<string, unknown>;
  rawResponse: string | null;
  actions: AiAction[] | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
