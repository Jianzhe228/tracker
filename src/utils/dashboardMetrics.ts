export type DashboardTimerState = {
  status: 'idle' | 'running' | 'paused';
  mode: 'focus' | 'shortBreak' | 'longBreak';
  timerKind: 'countdown' | 'countup';
  totalSeconds: number;
  remainingSeconds: number;
  elapsedSeconds: number;
};

export function getLiveFocusSeconds(timer: DashboardTimerState): number {
  if (timer.mode !== 'focus' || timer.status === 'idle') {
    return 0;
  }

  if (timer.timerKind === 'countdown') {
    return Math.max(0, timer.totalSeconds - timer.remainingSeconds);
  }

  return Math.max(0, timer.elapsedSeconds);
}

export function getLivePomodoros(timer: DashboardTimerState): number {
  const liveFocusSeconds = getLiveFocusSeconds(timer);
  if (liveFocusSeconds <= 0) {
    return 0;
  }

  return liveFocusSeconds / Math.max(60, timer.totalSeconds);
}

export function getDisplayedTodayFocusSeconds(
  persistedFocusSeconds: number,
  timer: DashboardTimerState,
): number {
  return persistedFocusSeconds + getLiveFocusSeconds(timer);
}

export function getDisplayedTodayPomodoros(
  persistedPomodoros: number,
  timer: DashboardTimerState,
): number {
  return persistedPomodoros + getLivePomodoros(timer);
}
