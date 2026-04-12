import { describe, expect, it } from 'vitest';

import {
  getDisplayedTodayFocusSeconds,
  getDisplayedTodayPomodoros,
  getLiveFocusSeconds,
  getLivePomodoros,
} from '../dashboardMetrics';

describe('dashboardMetrics', () => {
  it('adds live countup focus to persisted today focus', () => {
    expect(getDisplayedTodayFocusSeconds(120, {
      status: 'running',
      mode: 'focus',
      timerKind: 'countup',
      totalSeconds: 25 * 60,
      remainingSeconds: 25 * 60,
      elapsedSeconds: 360,
      currentSegmentSeconds: 360,
    })).toBe(480);
  });

  it('does not add live focus after the session is idle', () => {
    expect(getDisplayedTodayFocusSeconds(360, {
      status: 'idle',
      mode: 'focus',
      timerKind: 'countup',
      totalSeconds: 25 * 60,
      remainingSeconds: 25 * 60,
      elapsedSeconds: 360,
      currentSegmentSeconds: 360,
    })).toBe(360);
  });

  it('computes live pomodoros from the active session only', () => {
    expect(getLivePomodoros({
      status: 'running',
      mode: 'focus',
      timerKind: 'countup',
      totalSeconds: 25 * 60,
      remainingSeconds: 25 * 60,
      elapsedSeconds: 360,
      currentSegmentSeconds: 360,
    })).toBeCloseTo(0.24, 5);
  });

  it('does not double count completed pomodoros once session is idle', () => {
    expect(getDisplayedTodayPomodoros(0.2, {
      status: 'idle',
      mode: 'focus',
      timerKind: 'countup',
      totalSeconds: 25 * 60,
      remainingSeconds: 25 * 60,
      elapsedSeconds: 360,
      currentSegmentSeconds: 360,
    })).toBeCloseTo(0.2, 5);
  });

  it('returns zero live focus for non-focus modes', () => {
    expect(getLiveFocusSeconds({
      status: 'running',
      mode: 'shortBreak',
      timerKind: 'countdown',
      totalSeconds: 5 * 60,
      remainingSeconds: 120,
      elapsedSeconds: 0,
      currentSegmentSeconds: 120,
    })).toBe(0);
  });
});
