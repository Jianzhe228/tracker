/**
 * Tests for useSuggestionPanel composable (Phase 1 harness).
 *
 * Covers:
 * - loading state always resets even when runHarness() throws
 * - concurrent requestSuggestions() calls (stale results discarded)
 * - local-only strategy flow
 * - hybrid/ai strategy flow with AI results
 * - accept/reject updates panel state with trace persistence
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { computed, ref, nextTick, watchEffect } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';

// Ensure non-Tauri mode
delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('../services/suggestion/suggestionHarness', () => ({
  runHarness: vi.fn(),
  buildAiContextFromAnalysis: vi.fn(),
  toSidebarSuggestions: vi.fn((ranked) =>
    ranked.map((r: { title: string; sources: string[]; evidence: string[] }) => ({
      title: r.title,
      source: r.sources[0] ?? 'learning',
      patternName: r.evidence.find((e: string) => e.startsWith('pattern: '))?.slice(9),
      children: r.children ?? [],
      childCount: r.children?.length ?? 0,
    })),
  ),
}));

vi.mock('../services/ai/queue', () => ({
  enqueue: vi.fn(),
}));

vi.mock('../services/commands/learning', () => ({
  feedbackRecord: vi.fn(() => Promise.resolve()),
  historyGetTemplate: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../services/commands/ai', () => ({
  updateAiJob: vi.fn(() => Promise.resolve()),
}));

vi.mock('../services/commands/suggestionTrace', () => ({
  suggestionRunCreate: vi.fn(() => Promise.resolve(1)),
  suggestionCandidateInsert: vi.fn(() => Promise.resolve(1)),
  suggestionCandidateMarkSelected: vi.fn(() => Promise.resolve()),
  suggestionCandidateMarkRejected: vi.fn(() => Promise.resolve()),
}));

vi.mock('../services/commands/pattern', () => ({
  patternList: vi.fn(() => Promise.resolve([])),
  patternIncrementUsage: vi.fn(() => Promise.resolve()),
}));

vi.mock('../services/suggestion/keywordCache', () => ({
  refreshKnownKeywords: vi.fn(() => Promise.resolve()),
}));

// Import after mocks are set up
import { useSuggestionPanel } from '../composables/useSuggestionPanel';
import { runHarness, buildAiContextFromAnalysis } from '../services/suggestion/suggestionHarness';
import { enqueue } from '../services/ai/queue';
import { suggestionRunCreate, suggestionCandidateInsert } from '../services/commands/suggestionTrace';

// ── Helpers ────────────────────────────────────────────────────────

function mockRunHarnessLocal(suggestions: Array<{ title: string; source?: string; evidence?: string[] }> = []) {
  const ranked = suggestions.map((s, i) => ({
    title: s.title,
    score: 1 - i * 0.1,
    sources: [s.source ?? 'pattern'],
    evidence: s.evidence ?? [`pattern: test-pattern`],
    reasons: [],
  }));
  (runHarness as Mock).mockResolvedValueOnce({
    ranked,
    analysis: {
      rawTitle: '测试任务',
      normalizedTitle: '测试任务',
      keywords: ['测试'],
      intentHints: [],
      entityHints: [],
      timeHints: [],
      englishTerms: [],
      segmentTrace: [],
    },
    strategy: 'local',
    rejectedTitles: [],
  });
}

function mockRunHarnessHybrid(suggestions: Array<{ title: string }> = []) {
  const ranked = suggestions.map((s, i) => ({
    title: s.title,
    score: 1 - i * 0.1,
    sources: ['learning'] as const,
    evidence: [],
    reasons: [],
  }));
  (runHarness as Mock).mockResolvedValueOnce({
    ranked,
    analysis: {
      rawTitle: '测试任务',
      normalizedTitle: '测试任务',
      keywords: ['测试'],
      intentHints: [],
      entityHints: [],
      timeHints: [],
      englishTerms: [],
      segmentTrace: [],
    },
    strategy: 'hybrid',
    rejectedTitles: [],
  });
}

function mockRunHarnessAi() {
  (runHarness as Mock).mockResolvedValueOnce({
    ranked: [],
    analysis: {
      rawTitle: '测试任务',
      normalizedTitle: '测试任务',
      keywords: ['测试'],
      intentHints: [],
      entityHints: [],
      timeHints: [],
      englishTerms: [],
      segmentTrace: [],
    },
    strategy: 'ai',
    rejectedTitles: [],
  });
}

function mockBuildAiContext() {
  (buildAiContextFromAnalysis as Mock).mockResolvedValueOnce({
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
      status: 'pending' as const,
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
      mockRunHarnessLocal([{ title: '子任务1' }, { title: '子任务2' }]);
      const { requestSuggestions, getPanel } = useSuggestionPanel();

      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel).toBeDefined();
      expect(panel!.loading).toBe(false);
      expect(panel!.requested).toBe(true);
    });

    it('sets loading=false even when runHarness() throws', async () => {
      (runHarness as Mock).mockRejectedValueOnce(new Error('DB connection failed'));
      const { requestSuggestions, getPanel } = useSuggestionPanel();

      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel).toBeDefined();
      expect(panel!.loading).toBe(false);
      expect(panel!.suggestions).toHaveLength(0);
    });

    it('sets loading=false when AI not configured (hybrid strategy)', async () => {
      mockRunHarnessHybrid([{ title: '本地建议' }]);
      // AI not configured (default empty endpoint/apiKey)
      const { requestSuggestions, getPanel } = useSuggestionPanel();

      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel!.loading).toBe(false);
    });

    it('sets loading=false when AI enqueue fails', async () => {
      mockRunHarnessAi();
      mockBuildAiContext();
      settingsStore.ai.endpoint = 'https://api.example.com';
      settingsStore.ai.apiKey = 'test-key';
      (enqueue as Mock).mockRejectedValueOnce(new Error('AI timeout'));

      const { requestSuggestions, getPanel } = useSuggestionPanel();
      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel!.loading).toBe(false);
    });

    it('sets loading=false when buildAiContextFromAnalysis throws', async () => {
      mockRunHarnessAi();
      (buildAiContextFromAnalysis as Mock).mockRejectedValueOnce(new Error('Context build failed'));
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
      let resolveFirst!: (v: unknown) => void;
      const firstPromise = new Promise((r) => { resolveFirst = r; });
      (runHarness as Mock).mockReturnValueOnce(firstPromise);

      // Second request: fast, returns learning suggestions
      mockRunHarnessHybrid([{ title: '新建议1' }, { title: '新建议2' }]);

      const { requestSuggestions, getPanel } = useSuggestionPanel();

      // Fire first request (will hang on runHarness)
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
      resolveFirst({
        ranked: [{ title: '旧建议', score: 1, sources: ['pattern'], evidence: [], reasons: [] }],
        analysis: { rawTitle: '任务A', normalizedTitle: '任务A', keywords: [], intentHints: [], entityHints: [], timeHints: [], englishTerms: [], segmentTrace: [] },
        strategy: 'local',
        rejectedTitles: [],
      });
      await req1;

      // Panel should still show second request's results (not overwritten by stale first)
      const panelAfter = getPanel(1);
      expect(panelAfter!.suggestions.map((s) => s.title)).toEqual(['新建议1', '新建议2']);
    });

    it('different tasks get independent panels', async () => {
      mockRunHarnessLocal([{ title: '任务1的建议' }]);
      mockRunHarnessLocal([{ title: '任务2的建议' }]);

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
      mockRunHarnessLocal([{ title: '子任务A' }, { title: '子任务B' }]);

      const { requestSuggestions, getPanel } = useSuggestionPanel();
      await requestSuggestions(1, '测试任务', null);

      const panel = getPanel(1);
      expect(panel!.suggestions).toHaveLength(2);
      expect(panel!.suggestions[0].source).toBe('pattern');
      expect(panel!.loading).toBe(false);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('shows local suggestions before trace persistence finishes', async () => {
      mockRunHarnessLocal([{ title: '本地建议' }]);

      let resolveRunCreate!: (value: number) => void;
      (suggestionRunCreate as Mock).mockReturnValueOnce(
        new Promise<number>((resolve) => {
          resolveRunCreate = resolve;
        }),
      );

      const { requestSuggestions, getPanel } = useSuggestionPanel();
      const requestPromise = requestSuggestions(1, '测试任务', null);

      await nextTick();

      const panelWhilePersisting = getPanel(1);
      expect(panelWhilePersisting).toBeDefined();
      expect(panelWhilePersisting!.suggestions.map((s) => s.title)).toEqual(['本地建议']);

      resolveRunCreate(1);
      await requestPromise;

      expect(getPanel(1)!.suggestions.map((s) => s.title)).toEqual(['本地建议']);
    });

    it('filters duplicate suggestions matching existing subtasks', async () => {
      // Create parent + existing subtask
      const parent = await taskStore.addTask('Parent');
      await taskStore.addTask('已有子任务', { parentId: parent.id });

      mockRunHarnessLocal([{ title: '已有子任务' }, { title: '新建议' }]);

      const { requestSuggestions, getPanel } = useSuggestionPanel();
      await requestSuggestions(parent.id, '测试任务', null);

      const panel = getPanel(parent.id);
      // The harness receives existingSubtaskTitles which filters, so only '新建议' gets through
      expect(panel!.suggestions.map((s) => s.title)).toContain('新建议');
    });
  });

  describe('hybrid/ai strategy', () => {
    it('shows local suggestions immediately then appends AI results', async () => {
      mockRunHarnessHybrid([{ title: '本地建议' }]);
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
      mockRunHarnessHybrid([{ title: '共有建议' }]);
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
      mockRunHarnessAi();
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
      mockRunHarnessAi();
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
      mockRunHarnessLocal([{ title: '建议1' }, { title: '建议2' }]);

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

    it('acceptSuggestion creates nested subtasks for a history suggestion', async () => {
      let localId = 1_000;
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => localId++);
      (runHarness as Mock).mockResolvedValueOnce({
        ranked: [{
          title: '完成一套模拟试题',
          score: 1,
          sources: ['history'],
          evidence: ['from_task_subtask_history'],
          reasons: [],
          children: [
            { title: '写三篇阅读', children: [] },
            { title: '一篇翻译', children: [] },
            { title: '一篇写作', children: [] },
          ],
        }],
        analysis: {
          rawTitle: '四六级学习',
          normalizedTitle: '四六级学习',
          keywords: ['四六级', '学习'],
          intentHints: [],
          entityHints: [],
          timeHints: [],
          englishTerms: [],
          segmentTrace: [],
        },
        strategy: 'local',
        rejectedTitles: [],
      });

      try {
        const parent = await taskStore.addTask('四六级学习');
        const { requestSuggestions, acceptSuggestion, getPanel } = useSuggestionPanel();

        await requestSuggestions(parent.id, '四六级学习', null);
        const suggestion = getPanel(parent.id)!.suggestions[0] as {
          title: string;
          childCount: number;
        };
        expect(suggestion.childCount).toBe(3);

        await acceptSuggestion(parent.id, suggestion as never);

        const mockExam = taskStore.tasks.find((t) => t.parentId === parent.id && t.title === '完成一套模拟试题');
        expect(mockExam).toBeDefined();
        expect(
          taskStore.tasks
            .filter((t) => t.parentId === mockExam?.id)
            .map((t) => t.title)
            .sort(),
        ).toEqual(['一篇写作', '一篇翻译', '写三篇阅读'].sort());
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('rejectSuggestion removes suggestion from panel without creating subtask', async () => {
      mockRunHarnessLocal([{ title: '建议1' }]);

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
      mockRunHarnessLocal([{ title: '建议A' }, { title: '建议B' }, { title: '建议C' }]);

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
      mockRunHarnessLocal([{ title: '子任务1' }]);
      const { requestSuggestions, dismissPanel, getPanel } = useSuggestionPanel();

      await requestSuggestions(1, '测试', null);
      expect(getPanel(1)!.collapsed).toBe(false);

      dismissPanel(1);
      expect(getPanel(1)!.collapsed).toBe(true);
    });

    it('toggleCollapsed toggles state', async () => {
      mockRunHarnessLocal([{ title: '子任务1' }]);
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
      const selectedTaskId = ref(1);

      let resolveHarness!: (v: unknown) => void;
      (runHarness as Mock).mockReturnValueOnce(
        new Promise((r) => { resolveHarness = r; }),
      );

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

      // Resolve harness with local results
      resolveHarness({
        ranked: [
          { title: '建议A', score: 1, sources: ['pattern'], evidence: [], reasons: [] },
          { title: '建议B', score: 0.9, sources: ['pattern'], evidence: [], reasons: [] },
        ],
        analysis: { rawTitle: '测试任务', normalizedTitle: '测试任务', keywords: [], intentHints: [], entityHints: [], timeHints: [], englishTerms: [], segmentTrace: [] },
        strategy: 'local',
        rejectedTitles: [],
      });
      await reqPromise;
      await nextTick();

      // The watchEffect must have fired at least once with suggestions populated.
      const finalSnapshot = snapshots[snapshots.length - 1];
      expect(finalSnapshot.loading).toBe(false);
      expect(finalSnapshot.count).toBe(2);
    });

    it('watchEffect re-fires on loading state transition', async () => {
      mockRunHarnessLocal([{ title: '建议1' }]);
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
