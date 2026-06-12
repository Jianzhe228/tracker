/**
 * Tests for timerStore: pomodoro timing, segment tracking,
 * task switching, and focus session persistence.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { useSettingsStore } from '../settingsStore';
import { useTimerStore } from '../timerStore';

// Mock Tauri environment
Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {} });

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('timerStore', () => {
  let timerStore: ReturnType<typeof useTimerStore>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-03-28T10:00:00'));
    setActivePinia(createPinia());
    timerStore = useTimerStore();
    localStorageMock.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST: Pomodoro count is fractional
  // ══════════════════════════════════════════════════════════════════════════

  describe('pomodoro count calculation', () => {
    it('earns fractional pomodoro (0.5) when 20min elapsed on 40min timer', () => {
      timerStore.totalSeconds = 40 * 60;
      timerStore.remainingSeconds = 20 * 60; // 20 minutes remaining = 20 minutes elapsed
      timerStore.timerKind = 'countdown';
      timerStore.mode = 'focus';

      timerStore.finalizeFocusSession('stopped', false);

      // 20/40 = 0.5 pomodoro
      expect(timerStore.completedPomodoros).toBeCloseTo(0.5, 1);
    });

    it('earns 0.4 pomodoro when 10min elapsed on 25min timer', () => {
      timerStore.totalSeconds = 25 * 60;
      timerStore.remainingSeconds = 15 * 60; // 10 minutes elapsed
      timerStore.timerKind = 'countdown';
      timerStore.mode = 'focus';

      timerStore.finalizeFocusSession('stopped', false);

      // 10/25 = 0.4
      expect(timerStore.completedPomodoros).toBeCloseTo(0.4, 1);
    });

    it('earns 1 pomodoro when exactly 25min elapsed on 25min timer', () => {
      timerStore.totalSeconds = 25 * 60;
      timerStore.remainingSeconds = 0;
      timerStore.timerKind = 'countdown';
      timerStore.mode = 'focus';

      timerStore.finalizeFocusSession('completed', false);

      expect(timerStore.completedPomodoros).toBe(1);
    });

    it('accumulates fractional pomodoros across multiple sessions', () => {
      // Session 1: 10 min on 25 min timer = 0.4
      timerStore.totalSeconds = 25 * 60;
      timerStore.remainingSeconds = 15 * 60;
      timerStore.timerKind = 'countdown';
      timerStore.mode = 'focus';

      timerStore.finalizeFocusSession('stopped', false);

      // Session 2: another 10 min = +0.4 = 0.8
      timerStore.start();
      timerStore.totalSeconds = 25 * 60;
      timerStore.remainingSeconds = 15 * 60;
      timerStore.timerKind = 'countdown';
      timerStore.mode = 'focus';
      timerStore.finalizeFocusSession('stopped', false);

      expect(timerStore.completedPomodoros).toBeCloseTo(0.8, 1);
    });

    it('earns fractional pomodoro in countup mode', () => {
      timerStore.totalSeconds = 25 * 60;
      timerStore.elapsedSeconds = 30 * 60; // 30 minutes elapsed
      timerStore.timerKind = 'countup';
      timerStore.mode = 'focus';

      timerStore.finalizeFocusSession('stopped', false);

      // 30/25 = 1.2 pomodoros
      expect(timerStore.completedPomodoros).toBeCloseTo(1.2, 1);
    });

    it('earns partial pomodoro when timer stopped early (5min on 25min)', () => {
      timerStore.totalSeconds = 25 * 60;
      timerStore.remainingSeconds = 20 * 60; // 5 minutes actually worked
      timerStore.timerKind = 'countdown';
      timerStore.mode = 'focus';

      timerStore.finalizeFocusSession('stopped', false);

      // 5/25 = 0.2 pomodoros
      expect(timerStore.completedPomodoros).toBeCloseTo(0.2, 1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST: Segment tracking and task switching
  // ══════════════════════════════════════════════════════════════════════════

  describe('segment tracking', () => {
    it('creates a new segment when timer starts', () => {
      timerStore.start();

      expect(timerStore.segments).toHaveLength(1);
      expect(timerStore.segments[0].taskId).toBeNull();
      expect(timerStore.segments[0].closed).toBe(false);
      expect(timerStore.segments[0].syncedToDb).toBe(false);
    });

    it('closes current segment and opens new one when switching tasks', () => {
      timerStore.start();
      vi.advanceTimersByTime(5000); // 5 seconds in

      timerStore.setTask(1, 'Task 1');

      expect(timerStore.segments).toHaveLength(2);
      expect(timerStore.segments[0].closed).toBe(true);
      expect(timerStore.segments[1].taskId).toBe(1);
      expect(timerStore.segments[1].closed).toBe(false);
    });

    it('segments have correct duration after timing', () => {
      timerStore.start();
      vi.advanceTimersByTime(5000); // 5 seconds

      timerStore.setTask(1, 'Task 1');

      // First segment should have ~5 seconds of duration
      expect(timerStore.segments[0].durationMs).toBeGreaterThanOrEqual(4900);
      expect(timerStore.segments[0].durationMs).toBeLessThanOrEqual(6000);
    });

    it('second segment starts fresh after task switch', () => {
      timerStore.start();
      vi.advanceTimersByTime(5000);

      timerStore.setTask(1, 'Task 1');

      // Second segment should have 0 duration (just started)
      expect(timerStore.segments[1].durationMs).toBe(0);
      expect(timerStore.segments[1].closed).toBe(false);
    });

    it('clearTask also creates a new segment with null task', () => {
      timerStore.start();
      vi.advanceTimersByTime(5000);
      timerStore.setTask(1, 'Task 1');
      vi.advanceTimersByTime(3000);

      timerStore.clearTask();

      expect(timerStore.segments).toHaveLength(3);
      expect(timerStore.segments[2].taskId).toBeNull();
      expect(timerStore.segments[2].closed).toBe(false);
    });

    it('excludes paused time when closing a segment after resume', () => {
      timerStore.start();
      vi.advanceTimersByTime(5000);

      timerStore.pause();
      vi.advanceTimersByTime(10000);
      timerStore.resume();
      vi.advanceTimersByTime(3000);

      timerStore.setTask(1, 'Task 1');

      expect(timerStore.segments[0].durationMs).toBeGreaterThanOrEqual(7900);
      expect(timerStore.segments[0].durationMs).toBeLessThanOrEqual(9000);
    });

    it('break mode excludes paused time from remaining countdown', () => {
      timerStore.setMode('shortBreak');
      // totalSeconds is now shortBreak default (settings default = 5min)
      const total = timerStore.totalSeconds;
      timerStore.start();

      vi.advanceTimersByTime(30_000);
      timerStore.pause();
      vi.advanceTimersByTime(20_000);
      timerStore.resume();
      vi.advanceTimersByTime(10_000);

      // Only 30s + 10s = 40s should be consumed, not 60s
      const consumed = total - timerStore.remainingSeconds;
      expect(consumed).toBeGreaterThanOrEqual(38);
      expect(consumed).toBeLessThanOrEqual(42);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST: Timer state transitions
  // ══════════════════════════════════════════════════════════════════════════

  describe('timer state transitions', () => {
    it('starts in idle state', () => {
      expect(timerStore.status).toBe('idle');
    });

    it('transitions to running after start()', () => {
      timerStore.start();
      expect(timerStore.status).toBe('running');
    });

    it('transitions to paused after pause()', () => {
      timerStore.start();
      timerStore.pause();
      expect(timerStore.status).toBe('paused');
    });

    it('transitions back to running after resume()', () => {
      timerStore.start();
      timerStore.pause();
      timerStore.resume();
      expect(timerStore.status).toBe('running');
    });

    it('start() from paused resumes without dropping segments', () => {
      timerStore.setTask(1, 'Task A');
      timerStore.start();
      vi.advanceTimersByTime(60 * 1000); // 1 min of focus
      timerStore.pause();
      vi.advanceTimersByTime(30 * 1000); // 30s paused

      // e.g. clicking 专注 on a task row while paused calls start(), not resume()
      timerStore.start();

      expect(timerStore.status).toBe('running');
      // The original segment must survive — a full restart would wipe it and
      // lose the already-elapsed minute from the persisted session.
      expect(timerStore.segments).toHaveLength(1);
      expect(timerStore.segments[0].taskId).toBe(1);

      vi.advanceTimersByTime(60 * 1000); // 1 more min
      timerStore.finalizeFocusSession('stopped', false);
      expect(timerStore.focusSecondsToday).toBeGreaterThanOrEqual(118); // ~2 min, pause excluded
      expect(timerStore.focusSecondsToday).toBeLessThan(150);
    });

    it('resets to idle after stop()', () => {
      timerStore.start();
      timerStore.stop();
      expect(timerStore.status).toBe('idle');
    });

    it('countup mode increments elapsedSeconds', () => {
      timerStore.timerKind = 'countup';
      timerStore.mode = 'focus';
      timerStore.start();
      vi.advanceTimersByTime(30 * 1000); // 30 seconds

      expect(timerStore.elapsedSeconds).toBeGreaterThanOrEqual(29);
    });

    it('countdown mode decrements remainingSeconds', () => {
      timerStore.totalSeconds = 25 * 60;
      timerStore.remainingSeconds = 25 * 60;
      timerStore.timerKind = 'countdown';
      timerStore.mode = 'focus';
      timerStore.start();
      vi.advanceTimersByTime(30 * 1000); // 30 seconds

      expect(timerStore.remainingSeconds).toBeLessThan(25 * 60);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST: Daily pomodoro counter reset
  // ══════════════════════════════════════════════════════════════════════════

  describe('daily pomodoro counter', () => {
    it('resets completedPomodoros when day changes', () => {
      timerStore.completedPomodoros = 5;

      // Simulate day change
      vi.setSystemTime(new Date('2026-03-29T00:00:00'));
      timerStore.syncDailyPomodoroCounter();

      expect(timerStore.completedPomodoros).toBe(0);
    });

    it('resets focusSecondsToday when day changes', () => {
      timerStore.focusSecondsToday = 3600;

      vi.setSystemTime(new Date('2026-03-29T00:00:00'));
      timerStore.syncDailyPomodoroCounter();

      expect(timerStore.focusSecondsToday).toBe(0);
    });

    it('preserves completedPomodoros within the same day', () => {
      timerStore.completedPomodoros = 3;

      vi.setSystemTime(new Date('2026-03-28T15:00:00')); // Same day, afternoon
      timerStore.syncDailyPomodoroCounter();

      expect(timerStore.completedPomodoros).toBe(3);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST: flushAllClosedSegments
  // ══════════════════════════════════════════════════════════════════════════

  describe('flushAllClosedSegments', () => {
    it('does not flush open (unclosed) segments', () => {
      timerStore.start();
      vi.advanceTimersByTime(5000);

      // The segment is NOT closed yet
      timerStore.flushAllClosedSegments();

      // No segments should be flushed because none are closed
      // (flushAllClosedSegments checks seg.closed)
      const closedSegments = timerStore.segments.filter(s => s.closed);
      expect(closedSegments).toHaveLength(0);
    });

    it('closed segments have correct syncedToDb state', () => {
      timerStore.start();
      vi.advanceTimersByTime(5000);

      // Close the segment by switching task
      timerStore.setTask(1, 'Task 1');

      // First segment is now closed but not synced
      expect(timerStore.segments[0].closed).toBe(true);
      expect(timerStore.segments[0].syncedToDb).toBe(false);
    });
  });

  describe('today focus accounting', () => {
    it('includes the active segment when finalizing after a task switch', () => {
      timerStore.start();
      vi.advanceTimersByTime(5000);

      timerStore.setTask(1, 'Task 1');
      vi.advanceTimersByTime(3000);

      timerStore.stop();

      expect(timerStore.focusSecondsToday).toBe(8);
      expect(timerStore.completedPomodoros).toBeCloseTo(8 / (25 * 60), 3);
    });

    it('updates focusSecondsToday when a focus session ends without switching tasks', () => {
      timerStore.start();
      vi.advanceTimersByTime(10000);

      timerStore.stop();

      expect(timerStore.focusSecondsToday).toBe(10);
    });
  });


  // ══════════════════════════════════════════════════════════════════════════
  // TEST: Display and progress
  // ══════════════════════════════════════════════════════════════════════════

  describe('display and progress', () => {
    it('displays countdown correctly', () => {
      timerStore.totalSeconds = 25 * 60;
      timerStore.remainingSeconds = 5 * 60;
      timerStore.timerKind = 'countdown';

      expect(timerStore.display).toBe('05:00');
    });

    it('displays countup correctly', () => {
      timerStore.elapsedSeconds = 5 * 60 + 30; // 5 min 30 sec
      timerStore.timerKind = 'countup';

      expect(timerStore.display).toBe('05:30');
    });

    it('progress is 0 at start of countdown', () => {
      timerStore.totalSeconds = 25 * 60;
      timerStore.remainingSeconds = 25 * 60;
      timerStore.timerKind = 'countdown';

      expect(timerStore.progress).toBe(0);
    });

    it('progress is 100 at end of countdown', () => {
      timerStore.totalSeconds = 25 * 60;
      timerStore.remainingSeconds = 0;
      timerStore.timerKind = 'countdown';

      expect(timerStore.progress).toBe(100);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST: Idle timer follows settings loaded after hydration
  // ══════════════════════════════════════════════════════════════════════════

  describe('idle duration follows settings', () => {
    it('applies focusMinutes loaded after hydrateFromStorage to the idle timer', async () => {
      // App startup order: hydrateFromStorage runs before settings arrive from
      // the DB, so the idle timer is first initialized with the 25min default.
      timerStore.hydrateFromStorage();
      expect(timerStore.status).toBe('idle');
      expect(timerStore.totalSeconds).toBe(25 * 60);

      const settingsStore = useSettingsStore();
      settingsStore.timer.focusMinutes = 45;
      await nextTick();

      expect(timerStore.totalSeconds).toBe(45 * 60);
      expect(timerStore.remainingSeconds).toBe(45 * 60);
    });

    it('does not clobber a running timer when focusMinutes changes', async () => {
      timerStore.hydrateFromStorage();
      timerStore.start();
      vi.advanceTimersByTime(5000);
      const remainingBefore = timerStore.remainingSeconds;

      const settingsStore = useSettingsStore();
      settingsStore.timer.focusMinutes = 45;
      await nextTick();

      expect(timerStore.status).toBe('running');
      expect(timerStore.totalSeconds).toBe(25 * 60);
      expect(timerStore.remainingSeconds).toBeLessThanOrEqual(remainingBefore);
    });
  });
});
