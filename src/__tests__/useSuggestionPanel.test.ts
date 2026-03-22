/**
 * Tests for useSuggestionPanel composable.
 *
 * Covers:
 * - loading state always resets even when suggest() throws
 * - concurrent requestSuggestions() calls (stale results discarded)
 * - local-only strategy flow
 * - hybrid/ai strategy flow with AI results
 * - accept/reject updates panel state
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { computed, ref, nextTick, watchEffect } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';

// Ensure non-Tauri mode
delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('../services/suggestion', () => ({
  suggest: vi.fn(),
  buildAiContext: vi.fn(),
  extractKeywords: vi.fn(() => ['测试']),
  recordFeedback: vi.fn(),
}));

vi.mock('../services/ai/queue', () => ({
  enqueue: vi.fn(),
}));

vi.mock('../services/commands/learning', () => ({
  feedbackRecord: vi.fn(() => Promise.resolve()),
}));

vi.mock('../services/commands/ai', () => ({
  updateAiJob: vi.fn(() => Promise.resolve()),
}));

vi.mock('../services/suggestion/keywordCache', () => ({
  refreshKnownKeywords: vi.fn(() => Promise.resolve()),
}));

// Import after mocks are set up
import { useSuggestionPanel } from '../composables/useSuggestionPanel';
import { suggest, buildAiContext } from '../services/suggestion';
import { enqueue } from '../services/ai/queue';

// ── Helpers ────────────────────────────────────────────────────────

function mockSuggestLocal(suggestions: string[] = ['子任务1', '子任务2']) {
  (suggest as Mock).mockResolvedValueOnce({
    result: {
      source: 'pattern',
      suggestions,
      patternName: 'test-pattern',
    },
    strategy: 'local',
    keywords: ['测试'],
  });
}

function mockSuggestHybrid(suggestions: string[] = ['本地建议']) {
  (suggest as Mock).mockResolvedValueOnce({
    result: {
      source: 'learning',
      suggestions,
    },
    strategy: 'hybrid',
    keywords: ['测试'],
  });
}

function mockSuggestAi() {
  (suggest as Mock).mockResolvedValueOnce({
    result: { source: 'none', suggestions: [] },
    strategy: 'ai',
    keywords: ['测试'],
  });
}

function mockBuildAiContext() {
  (buildAiContext as Mock).mockResolvedValueOnce({
    userPatterns: '',
    learnedItems: '',
    rejectedItems: '',
    manualSubtasks: '',
    siblingTasks: '',
  });
}

function mockEnqueueWithActions(titles: string[]) {
  (enqueue as Mock).mockResolvedValueOnce({
    id: 1,
    status: 'completed',
    actions: titles.map((title) => ({
      type: 'create_subtask',
      params: { title },
      status: 'pending',
    })),
  });
}

function mockEnqueueEmpty() {
  (enqueue as Mock).mockResolvedValueOnce({
    id: 1,
    status: 'completed',
    actions: [],
  });
}

function mockEnqueueNull() {
  (enqueue as Mock).mockResolvedValueOnce(null);
}

// ── Tests ──────────────────────────────────────────────────────────

describe('useSuggestionPanel', () => {
  let taskStore: ReturnType<typeof useTaskStore>;
  let settingsStore: ReturnType<typeof useSettingsStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    taskStore = useTaskStore();
    settingsStore = useSettingsStore();
  });

  // ── Loading state ──

  describe('loading state management', () => {
    it('sets loading=true during request and loading=false when done (local strategy)', async () => {
      mockSuggestLocal();
      const { requestSuggestions, getPanel } = useSuggestionPanel();

      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel).toBeDefined();
      expect(panel!.loading).toBe(false);
      expect(panel!.requested).toBe(true);
    });

    it('sets loading=false even when suggest() throws', async () => {
      (suggest as Mock).mockRejectedValueOnce(new Error('DB connection failed'));
      const { requestSuggestions, getPanel } = useSuggestionPanel();

      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel).toBeDefined();
      expect(panel!.loading).toBe(false);
      expect(panel!.suggestions).toHaveLength(0);
    });

    it('sets loading=false when AI not configured (hybrid strategy)', async () => {
      mockSuggestHybrid();
      // AI not configured (default empty endpoint/apiKey)
      const { requestSuggestions, getPanel } = useSuggestionPanel();

      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel!.loading).toBe(false);
    });

    it('sets loading=false when AI enqueue fails', async () => {
      mockSuggestAi();
      mockBuildAiContext();
      settingsStore.ai.endpoint = 'https://api.example.com';
      settingsStore.ai.apiKey = 'test-key';
      (enqueue as Mock).mockRejectedValueOnce(new Error('AI timeout'));

      const { requestSuggestions, getPanel } = useSuggestionPanel();
      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel!.loading).toBe(false);
    });

    it('sets loading=false when buildAiContext throws', async () => {
      mockSuggestAi();
      (buildAiContext as Mock).mockRejectedValueOnce(new Error('Context build failed'));
      settingsStore.ai.endpoint = 'https://api.example.com';
      settingsStore.ai.apiKey = 'test-key';

      const { requestSuggestions, getPanel } = useSuggestionPanel();
      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel!.loading).toBe(false);
    });
  });

  // ── Concurrent requests ──

  describe('concurrent request handling', () => {
    it('second request for same task overrides first request results', async () => {
      // First request: slow, returns pattern suggestions
      let resolveFirst: (v: unknown) => void;
      const firstPromise = new Promise((r) => { resolveFirst = r; });
      (suggest as Mock).mockReturnValueOnce(firstPromise);

      // Second request: fast, returns learning suggestions
      mockSuggestLocal(['新建议1', '新建议2']);

      const { requestSuggestions, getPanel } = useSuggestionPanel();

      // Fire first request (will hang on suggest())
      const req1 = requestSuggestions(1, '任务A', null);

      // Fire second request immediately
      const req2 = requestSuggestions(1, '任务B', null);

      // Wait for second to complete
      await req2;

      // Panel should show second request's results
      const panel = getPanel(1);
      expect(panel!.loading).toBe(false);
      expect(panel!.suggestions.map((s) => s.title)).toEqual(['新建议1', '新建议2']);

      // Resolve first request (stale)
      resolveFirst!({
        result: { source: 'pattern', suggestions: ['旧建议'] },
        strategy: 'local',
        keywords: ['任务A'],
      });
      await req1;

      // Panel should still show second request's results (not overwritten by stale first)
      const panelAfter = getPanel(1);
      // Note: without request versioning, the stale first request WILL overwrite.
      // This test documents the expected behavior after the fix.
      expect(panelAfter!.suggestions.map((s) => s.title)).toEqual(['新建议1', '新建议2']);
    });

    it('different tasks get independent panels', async () => {
      mockSuggestLocal(['任务1的建议']);
      mockSuggestLocal(['任务2的建议']);

      const { requestSuggestions, getPanel } = useSuggestionPanel();

      await requestSuggestions(1, '任务1', null);
      await requestSuggestions(2, '任务2', null);

      expect(getPanel(1)!.suggestions[0].title).toBe('任务1的建议');
      expect(getPanel(2)!.suggestions[0].title).toBe('任务2的建议');
    });
  });

  // ── Strategy flows ──

  describe('local strategy', () => {
    it('shows local suggestions without calling AI', async () => {
      mockSuggestLocal(['子任务A', '子任务B']);

      const { requestSuggestions, getPanel } = useSuggestionPanel();
      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel!.suggestions).toHaveLength(2);
      expect(panel!.suggestions[0].source).toBe('pattern');
      expect(panel!.loading).toBe(false);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('filters duplicate suggestions matching existing subtasks', async () => {
      // Create parent + existing subtask
      const parent = await taskStore.addTask('Parent');
      await taskStore.addTask('已有子任务', { parentId: parent.id });

      mockSuggestLocal(['已有子任务', '新建议']);

      const { requestSuggestions, getPanel } = useSuggestionPanel();
      await requestSuggestions(parent.id, '测试任务', null);

      const panel = getPanel(parent.id);
      expect(panel!.suggestions).toHaveLength(1);
      expect(panel!.suggestions[0].title).toBe('新建议');
    });
  });

  describe('hybrid/ai strategy', () => {
    it('shows local suggestions immediately then appends AI results', async () => {
      mockSuggestHybrid(['本地建议']);
      mockBuildAiContext();
      mockEnqueueWithActions(['AI建议1', 'AI建议2']);
      settingsStore.ai.endpoint = 'https://api.example.com';
      settingsStore.ai.apiKey = 'test-key';

      const { requestSuggestions, getPanel } = useSuggestionPanel();
      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel!.suggestions).toHaveLength(3);
      expect(panel!.suggestions.map((s) => s.title)).toEqual([
        '本地建议',
        'AI建议1',
        'AI建议2',
      ]);
      expect(panel!.loading).toBe(false);
    });

    it('deduplicates AI suggestions against local suggestions', async () => {
      mockSuggestHybrid(['共有建议']);
      mockBuildAiContext();
      mockEnqueueWithActions(['共有建议', 'AI独有建议']);
      settingsStore.ai.endpoint = 'https://api.example.com';
      settingsStore.ai.apiKey = 'test-key';

      const { requestSuggestions, getPanel } = useSuggestionPanel();
      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      const titles = panel!.suggestions.map((s) => s.title);
      expect(titles).toContain('共有建议');
      expect(titles).toContain('AI独有建议');
      // '共有建议' should appear only once (from local, not duplicated from AI)
      expect(titles.filter((t) => t === '共有建议')).toHaveLength(1);
    });

    it('handles AI returning null job', async () => {
      mockSuggestAi();
      mockBuildAiContext();
      mockEnqueueNull();
      settingsStore.ai.endpoint = 'https://api.example.com';
      settingsStore.ai.apiKey = 'test-key';

      const { requestSuggestions, getPanel } = useSuggestionPanel();
      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel!.loading).toBe(false);
      expect(panel!.suggestions).toHaveLength(0);
    });

    it('handles AI returning empty actions', async () => {
      mockSuggestAi();
      mockBuildAiContext();
      mockEnqueueEmpty();
      settingsStore.ai.endpoint = 'https://api.example.com';
      settingsStore.ai.apiKey = 'test-key';

      const { requestSuggestions, getPanel } = useSuggestionPanel();
      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel!.loading).toBe(false);
      expect(panel!.suggestions).toHaveLength(0);
    });
  });

  // ── Accept / Reject ──

  describe('accept and reject', () => {
    it('acceptSuggestion creates subtask and removes suggestion from panel', async () => {
      mockSuggestLocal(['建议1', '建议2']);

      const parent = await taskStore.addTask('Parent');
      const { requestSuggestions, acceptSuggestion, getPanel } = useSuggestionPanel();

      await requestSuggestions(parent.id, 'Parent', null);
      const panel = getPanel(parent.id);
      expect(panel!.suggestions).toHaveLength(2);

      await acceptSuggestion(parent.id, panel!.suggestions[0]);

      // Suggestion removed from panel
      expect(getPanel(parent.id)!.suggestions).toHaveLength(1);
      expect(getPanel(parent.id)!.suggestions[0].title).toBe('建议2');

      // Subtask created in store
      const subtasks = taskStore.tasks.filter((t) => t.parentId === parent.id);
      expect(subtasks).toHaveLength(1);
      expect(subtasks[0].title).toBe('建议1');
    });

    it('rejectSuggestion removes suggestion from panel without creating subtask', async () => {
      mockSuggestLocal(['建议1']);

      const parent = await taskStore.addTask('Parent');
      const { requestSuggestions, rejectSuggestion, getPanel } = useSuggestionPanel();

      await requestSuggestions(parent.id, 'Parent', null);
      const suggestion = getPanel(parent.id)!.suggestions[0];

      rejectSuggestion(parent.id, suggestion);

      expect(getPanel(parent.id)!.suggestions).toHaveLength(0);
      // No subtask created
      const subtasks = taskStore.tasks.filter((t) => t.parentId === parent.id);
      expect(subtasks).toHaveLength(0);
    });

    it('acceptAll creates subtasks for all suggestions', async () => {
      mockSuggestLocal(['建议A', '建议B', '建议C']);

      const parent = await taskStore.addTask('Parent');
      const { requestSuggestions, acceptAll, getPanel } = useSuggestionPanel();

      await requestSuggestions(parent.id, 'Parent', null);
      await acceptAll(parent.id);

      expect(getPanel(parent.id)!.suggestions).toHaveLength(0);
      const subtasks = taskStore.tasks.filter((t) => t.parentId === parent.id);
      expect(subtasks).toHaveLength(3);
    });
  });

  // ── Dismiss / Collapse ──

  describe('dismiss and collapse', () => {
    it('dismissPanel sets collapsed=true', async () => {
      mockSuggestLocal();
      const { requestSuggestions, dismissPanel, getPanel } = useSuggestionPanel();

      await requestSuggestions(1, '测试', null);
      expect(getPanel(1)!.collapsed).toBe(false);

      dismissPanel(1);
      expect(getPanel(1)!.collapsed).toBe(true);
    });

    it('toggleCollapsed toggles state', async () => {
      mockSuggestLocal();
      const { requestSuggestions, toggleCollapsed, getPanel } = useSuggestionPanel();

      await requestSuggestions(1, '测试', null);

      toggleCollapsed(1);
      expect(getPanel(1)!.collapsed).toBe(true);

      toggleCollapsed(1);
      expect(getPanel(1)!.collapsed).toBe(false);
    });
  });

  // ── Vue reactivity ──

  describe('Vue reactivity (computed panel tracks state changes)', () => {
    it('watchEffect re-fires when suggestions change, without changing selectedTask', async () => {
      // This test simulates how Vue templates work:
      // A template render effect reads computed properties → re-renders when they change.
      // If the computed returns the same object reference, Vue skips re-render.
      const selectedTaskId = ref(1);

      let resolveSuggest!: (v: unknown) => void;
      (suggest as Mock).mockReturnValueOnce(new Promise((r) => { resolveSuggest = r; }));

      const { requestSuggestions, getPanel } = useSuggestionPanel();

      const currentPanel = computed(() => {
        if (!selectedTaskId.value) return undefined;
        return getPanel(selectedTaskId.value);
      });

      // Track how many times the "render effect" fires and what it sees
      const snapshots: { loading: boolean; count: number }[] = [];
      watchEffect(() => {
        const p = currentPanel.value;
        if (p) {
          snapshots.push({ loading: p.loading, count: p.suggestions.length });
        }
      });

      // Fire request — sets loading=true synchronously
      const reqPromise = requestSuggestions(1, '测试任务', null);
      await nextTick();

      // Resolve suggest() with local results
      resolveSuggest({
        result: { source: 'pattern', suggestions: ['建议A', '建议B'] },
        strategy: 'local',
        keywords: ['测试'],
      });
      await reqPromise;
      await nextTick();

      // The watchEffect must have fired at least once with suggestions populated.
      // If reactivity is broken, it only fires with loading=true and never again.
      const finalSnapshot = snapshots[snapshots.length - 1];
      expect(finalSnapshot.loading).toBe(false);
      expect(finalSnapshot.count).toBe(2);
    });

    it('watchEffect re-fires on loading state transition', async () => {
      mockSuggestLocal(['建议1']);
      const selectedTaskId = ref(1);
      const { requestSuggestions, getPanel } = useSuggestionPanel();

      const currentPanel = computed(() => {
        if (!selectedTaskId.value) return undefined;
        return getPanel(selectedTaskId.value);
      });

      const loadingStates: boolean[] = [];
      watchEffect(() => {
        const p = currentPanel.value;
        if (p) {
          loadingStates.push(p.loading);
        }
      });

      await requestSuggestions(1, '测试', null);
      await nextTick();

      // Must have seen loading=true then loading=false transition
      expect(loadingStates).toContain(true);
      expect(loadingStates).toContain(false);
      expect(loadingStates[loadingStates.length - 1]).toBe(false);
    });
  });
});
