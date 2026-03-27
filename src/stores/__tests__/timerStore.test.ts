/**
 * Tests for timerStore: pomodoro timing, segment tracking,
 * task switching, and focus session persistence.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
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
    setActivePinia(createPinia());
    timerStore = useTimerStore();
    localStorageMock.clear();
    // Reset Date.now
    vi.setSystemTime(new Date('2026-03-28T10:00:00'));
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
});
