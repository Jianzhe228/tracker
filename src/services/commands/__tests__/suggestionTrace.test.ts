/**
 * Tests for suggestion trace command wrappers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeCommand } from '../invoke';

vi.mock('../invoke', () => ({
  invokeCommand: vi.fn().mockResolvedValue(undefined),
}));

import {
  suggestionRunCreate,
  suggestionCandidateInsert,
  suggestionCandidateMarkSelected,
  suggestionCandidateMarkRejected,
} from '../suggestionTrace';

describe('suggestionTrace commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls suggestion_run_create with camelCase payload keys', async () => {
    await suggestionRunCreate({
      taskId: 1,
      taskTitle: '测试任务',
      projectId: 2,
      analysisJson: '{"keywords":["测试"]}',
      strategy: 'hybrid',
    });

    expect(invokeCommand).toHaveBeenCalledWith('suggestion_run_create', {
      taskId: 1,
      taskTitle: '测试任务',
      projectId: 2,
      analysisJson: '{"keywords":["测试"]}',
      strategy: 'hybrid',
    });
  });

  it('calls suggestion_candidate_insert with camelCase payload keys', async () => {
    await suggestionCandidateInsert({
      runId: 5,
      title: '子任务',
      source: 'pattern',
      mergedSourcesJson: '["pattern","history"]',
      score: 0.9,
      evidenceJson: '["pattern: test"]',
      reasonsJson: '["source_count: 2"]',
      shownRank: 1,
    });

    expect(invokeCommand).toHaveBeenCalledWith('suggestion_candidate_insert', {
      runId: 5,
      title: '子任务',
      source: 'pattern',
      mergedSourcesJson: '["pattern","history"]',
      score: 0.9,
      evidenceJson: '["pattern: test"]',
      reasonsJson: '["source_count: 2"]',
      shownRank: 1,
    });
  });

  it('calls suggestion_candidate_mark_selected with camelCase payload key', async () => {
    await suggestionCandidateMarkSelected(9);

    expect(invokeCommand).toHaveBeenCalledWith('suggestion_candidate_mark_selected', {
      candidateId: 9,
    });
  });

  it('calls suggestion_candidate_mark_rejected with camelCase payload key', async () => {
    await suggestionCandidateMarkRejected(11);

    expect(invokeCommand).toHaveBeenCalledWith('suggestion_candidate_mark_rejected', {
      candidateId: 11,
    });
  });
});
