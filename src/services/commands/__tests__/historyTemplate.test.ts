/**
 * Tests for the history template learning command wrapper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeCommand } from '../invoke';

vi.mock('../invoke', () => ({
  invokeCommand: vi.fn().mockResolvedValue([]),
}));

describe('learning commands - history template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls invokeCommand with the history template payload', async () => {
    const commands = await import('../learning');
    expect(typeof commands.historyGetTemplate).toBe('function');

    await commands.historyGetTemplate('四六级学习', ['四六级', '学习'], 1, 2);

    expect(invokeCommand).toHaveBeenCalledWith('history_get_template', {
      taskTitle: '四六级学习',
      keywords: ['四六级', '学习'],
      projectId: 1,
      maxDepth: 2,
    });
  });
});
