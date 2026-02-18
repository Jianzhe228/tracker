import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useSettingsStore } from './settingsStore';
import { notify } from '../services/notification';

export type TimerMode = 'focus' | 'shortBreak' | 'longBreak';
export type TimerStatus = 'idle' | 'running' | 'paused';
export type TimerKind = 'countdown' | 'countup';

type PersistedTimerState = {
  version: number;
  status: TimerStatus;
  mode: TimerMode;
  timerKind: TimerKind;
  remainingSeconds: number;
  elapsedSeconds: number;
  totalSeconds: number;
  completedPomodoros: number;
  pomodoroDateKey: string;
  breakExtendCount: number;
  currentTaskId: number | null;
  currentTaskTitle: string | null;
  startedAt: number | null;
  lastTickAt: number | null;
  pauseStartedAt: number | null;
  pauseDurationSeconds: number;
  accumulatedPauseMs: number;
};

type SessionStatus = 'completed' | 'stopped' | 'breakSkipped';

type SessionLog = {
  id: string;
  taskId: number | null;
  taskTitle: string | null;
  status: SessionStatus;
  note?: string;
  finishedAt: string;
  mode: TimerMode;
  spentSeconds: number;
  pomodoros: number;
};

const STORAGE_KEY = 'sft_timer_state_v1';
const SESSION_LOG_KEY = 'sft_timer_sessions';
const SECOND = 1000;
const PERSIST_INTERVAL_MS = 30_000;
const PAUSE_WARNING_SECONDS = 30 * 60;
const PAUSE_FORCE_STOP_SECONDS = 2 * 60 * 60;

function getTodayKey(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function playTone(kind: 'start' | 'complete' | 'breakEnd'): void {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'start' ? 880 : kind === 'complete' ? 660 : 520;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.start(now);
    osc.stop(now + 0.3);
    osc.onended = () => ctx.close();
  } catch (error) {
    console.warn('[timer] failed to play tone', error);
  }
}

export const useTimerStore = defineStore('timer', () => {
  const settingsStore = useSettingsStore();

  const status = ref<TimerStatus>('idle');
  const mode = ref<TimerMode>('focus');
  const timerKind = ref<TimerKind>('countdown');
  const totalSeconds = ref<number>(0);
  const remainingSeconds = ref<number>(0);
  const elapsedSeconds = ref<number>(0);
  const completedPomodoros = ref(0);
  const pomodoroDateKey = ref(getTodayKey());
  const breakExtendCount = ref(0);
  const pauseWarning = ref(false);
  const pauseDurationSeconds = ref(0);
  const accumulatedPauseMs = ref(0);
  const currentTaskId = ref<number | null>(null);
  const currentTaskTitle = ref<string | null>(null);
  const awaitingRecovery = ref(false);
  const recoveryTargetStatus = ref<TimerStatus | null>(null);

  const startedAt = ref<number | null>(null);
  const lastTickAt = ref<number | null>(null);
  const pauseStartedAt = ref<number | null>(null);

  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastPersistAt = 0;

  const running = computed(() => status.value === 'running');
  const paused = computed(() => status.value === 'paused');
  const idle = computed(() => status.value === 'idle');

  const displaySeconds = computed(() => (timerKind.value === 'countup' ? elapsedSeconds.value : remainingSeconds.value));

  const display = computed(() => {
    const min = Math.floor(displaySeconds.value / 60)
      .toString()
      .padStart(2, '0');
    const sec = Math.max(0, displaySeconds.value % 60)
      .toString()
      .padStart(2, '0');
    return `${min}:${sec}`;
  });

  const progress = computed(() => {
    if (timerKind.value === 'countdown') {
      if (totalSeconds.value <= 0) return 0;
      return ((totalSeconds.value - remainingSeconds.value) / totalSeconds.value) * 100;
    }
    const baseline = Math.max(60, getDefaultSeconds('focus'));
    return Math.min(100, (elapsedSeconds.value / baseline) * 100);
  });

  const modeLabel = computed(() => {
    switch (mode.value) {
      case 'focus': return '专注';
      case 'shortBreak': return '短休息';
      case 'longBreak': return '长休息';
    }
  });

  const pauseExceededLimit = computed(() => pauseDurationSeconds.value >= PAUSE_FORCE_STOP_SECONDS);

  function getDefaultSeconds(targetMode: TimerMode): number {
    const focusMinutes = Math.max(1, Math.round(settingsStore.pomodoro.focusMinutes || 25));
    const shortBreakMinutes = Math.max(1, Math.round(settingsStore.pomodoro.shortBreakMinutes || 5));
    const longBreakMinutes = Math.max(1, Math.round(settingsStore.pomodoro.longBreakMinutes || 15));
    switch (targetMode) {
      case 'focus': return focusMinutes * 60;
      case 'shortBreak': return shortBreakMinutes * 60;
      case 'longBreak': return longBreakMinutes * 60;
    }
  }

  function syncDailyPomodoroCounter(): void {
    const todayKey = getTodayKey();
    if (pomodoroDateKey.value !== todayKey) {
      pomodoroDateKey.value = todayKey;
      completedPomodoros.value = 0;
    }
  }

  function saveState(force = false): void {
    if (typeof localStorage === 'undefined') return;
    const now = Date.now();
    if (!force && now - lastPersistAt < PERSIST_INTERVAL_MS) return;
    lastPersistAt = now;

    const payload: PersistedTimerState = {
      version: 1,
      status: status.value,
      mode: mode.value,
      timerKind: timerKind.value,
      remainingSeconds: remainingSeconds.value,
      elapsedSeconds: elapsedSeconds.value,
      totalSeconds: totalSeconds.value,
      completedPomodoros: completedPomodoros.value,
      pomodoroDateKey: pomodoroDateKey.value,
      breakExtendCount: breakExtendCount.value,
      currentTaskId: currentTaskId.value,
      currentTaskTitle: currentTaskTitle.value,
      startedAt: startedAt.value,
      lastTickAt: lastTickAt.value,
      pauseStartedAt: pauseStartedAt.value,
      pauseDurationSeconds: pauseDurationSeconds.value,
      accumulatedPauseMs: accumulatedPauseMs.value
    };

    for (let i = 0; i < 3; i++) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        return;
      } catch (error) {
        console.warn('[timer] failed to persist state', error);
      }
    }
  }

  function loadState(): PersistedTimerState | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PersistedTimerState;
      return parsed?.version === 1 ? parsed : null;
    } catch (error) {
      console.warn('[timer] failed to parse persisted state', error);
      return null;
    }
  }

  function appendSessionLog(entry: SessionLog): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(SESSION_LOG_KEY);
      const list: SessionLog[] = raw ? JSON.parse(raw) : [];
      list.unshift(entry);
      if (list.length > 30) {
        list.length = 30;
      }
      localStorage.setItem(SESSION_LOG_KEY, JSON.stringify(list));
    } catch (error) {
      console.warn('[timer] failed to write session log', error);
    }
  }

  function recordSession(statusLabel: SessionStatus, pomodoros: number, note?: string): void {
    const finishedAt = new Date().toISOString();
    const spentSeconds = timerKind.value === 'countdown'
      ? Math.max(0, totalSeconds.value - remainingSeconds.value)
      : elapsedSeconds.value;
    const entry: SessionLog = {
      id: `${Date.now()}`,
      taskId: currentTaskId.value,
      taskTitle: currentTaskTitle.value,
      status: statusLabel,
      note,
      finishedAt,
      mode: mode.value,
      spentSeconds,
      pomodoros
    };
    appendSessionLog(entry);
  }

  function startTicker(): void {
    if (intervalId) return;
    intervalId = setInterval(tick, SECOND);
  }

  function stopTicker(): void {
    if (!intervalId) return;
    clearInterval(intervalId);
    intervalId = null;
  }

  function resetPauseTracking(): void {
    pauseStartedAt.value = null;
    pauseDurationSeconds.value = 0;
    pauseWarning.value = false;
  }

  function resetToIdleFocus(): void {
    status.value = 'idle';
    mode.value = 'focus';
    timerKind.value = 'countdown';
    totalSeconds.value = getDefaultSeconds('focus');
    remainingSeconds.value = totalSeconds.value;
    elapsedSeconds.value = 0;
    breakExtendCount.value = 0;
    startedAt.value = null;
    lastTickAt.value = null;
    resetPauseTracking();
    accumulatedPauseMs.value = 0;
    awaitingRecovery.value = false;
    recoveryTargetStatus.value = null;
    stopTicker();
    saveState(true);
  }

  function setMode(newMode: TimerMode): void {
    if (!idle.value) return;
    mode.value = newMode;
    timerKind.value = 'countdown';
    totalSeconds.value = getDefaultSeconds(newMode);
    remainingSeconds.value = totalSeconds.value;
    elapsedSeconds.value = 0;
    breakExtendCount.value = 0;
    saveState(true);
  }

  function setTimerKind(kind: TimerKind): void {
    if (!idle.value || mode.value !== 'focus') return;
    timerKind.value = kind;
    elapsedSeconds.value = 0;
    totalSeconds.value = getDefaultSeconds('focus');
    remainingSeconds.value = totalSeconds.value;
    saveState(true);
  }

  function ensureProgressBaseline(): void {
    if (totalSeconds.value <= 0) {
      totalSeconds.value = getDefaultSeconds(mode.value);
    }
    if (timerKind.value === 'countdown' && remainingSeconds.value <= 0) {
      remainingSeconds.value = totalSeconds.value;
    }
    if (timerKind.value === 'countup' && elapsedSeconds.value < 0) {
      elapsedSeconds.value = 0;
    }
  }

  function start(): void {
    if (running.value) return;
    syncDailyPomodoroCounter();
    ensureProgressBaseline();
    status.value = 'running';
    startedAt.value = Date.now();
    lastTickAt.value = startedAt.value;
    resetPauseTracking();
    accumulatedPauseMs.value = 0;
    awaitingRecovery.value = false;
    recoveryTargetStatus.value = null;
    startTicker();
    if (mode.value === 'focus') {
      notify(`开始专注：${currentTaskTitle.value || '专注任务'}`);
      playTone('start');
    }
    saveState(true);
  }

  function pause(): void {
    if (!running.value) return;
    status.value = 'paused';
    pauseStartedAt.value = Date.now();
    pauseDurationSeconds.value = 0;
    pauseWarning.value = false;
    startTicker();
    saveState(true);
  }

  function resume(): void {
    if (!paused.value) return;
    const now = Date.now();
    if (pauseStartedAt.value) {
      accumulatedPauseMs.value += now - pauseStartedAt.value;
    }
    status.value = 'running';
    pauseStartedAt.value = null;
    pauseDurationSeconds.value = 0;
    pauseWarning.value = false;
    lastTickAt.value = now;
    awaitingRecovery.value = false;
    recoveryTargetStatus.value = null;
    startTicker();
    saveState(true);
  }

  function finalizeFocusSession(statusLabel: SessionStatus, startBreak = true, note?: string): void {
    const focusSeconds = Math.max(60, getDefaultSeconds('focus'));
    const spentSeconds = timerKind.value === 'countdown'
      ? Math.max(0, totalSeconds.value - remainingSeconds.value)
      : elapsedSeconds.value;
    const pomodorosEarned = Math.max(1, Math.ceil(spentSeconds / focusSeconds));
    completedPomodoros.value += pomodorosEarned;
    recordSession(statusLabel, pomodorosEarned, note);

    if (startBreak) {
      const useLongBreak = completedPomodoros.value > 0 && completedPomodoros.value % 4 === 0;
      const nextBreak: TimerMode = useLongBreak ? 'longBreak' : 'shortBreak';
      notify(`专注结束，进入${useLongBreak ? '长休息' : '休息'} (${useLongBreak ? 15 : 5} 分钟)`);
      playTone('complete');
      startBreakCountdown(nextBreak);
    } else {
      resetToIdleFocus();
    }
  }

  function tick(): void {
    const now = Date.now();
    if (!lastTickAt.value) {
      lastTickAt.value = now;
      saveState();
      return;
    }

    const deltaSeconds = Math.max(0, Math.floor((now - lastTickAt.value) / 1000));
    lastTickAt.value = now;
    syncDailyPomodoroCounter();

    if (running.value) {
      if (mode.value === 'focus') {
        if (timerKind.value === 'countdown') {
          remainingSeconds.value = Math.max(0, remainingSeconds.value - deltaSeconds);
          if (remainingSeconds.value <= 0) {
            finalizeFocusSession('completed', true);
            return;
          }
        } else {
          elapsedSeconds.value += deltaSeconds;
        }
      } else {
        remainingSeconds.value = Math.max(0, remainingSeconds.value - deltaSeconds);
        if (remainingSeconds.value <= 0) {
          completeBreak();
          return;
        }
      }
    } else if (paused.value && pauseStartedAt.value) {
      pauseDurationSeconds.value = Math.max(
        pauseDurationSeconds.value,
        Math.floor((now - pauseStartedAt.value) / 1000)
      );
      pauseWarning.value = pauseDurationSeconds.value >= PAUSE_WARNING_SECONDS;
      if (mode.value === 'focus' && pauseDurationSeconds.value >= PAUSE_FORCE_STOP_SECONDS) {
        notify('暂停超时，已自动结束本次计时');
        finalizeFocusSession('stopped', false, 'pause_timeout');
        return;
      }
    }

    saveState();
  }

  function startBreakCountdown(nextMode: Extract<TimerMode, 'shortBreak' | 'longBreak'>): void {
    mode.value = nextMode;
    timerKind.value = 'countdown';
    totalSeconds.value = getDefaultSeconds(nextMode);
    remainingSeconds.value = totalSeconds.value;
    elapsedSeconds.value = 0;
    status.value = 'running';
    startedAt.value = Date.now();
    lastTickAt.value = startedAt.value;
    breakExtendCount.value = 0;
    resetPauseTracking();
    accumulatedPauseMs.value = 0;
    startTicker();
    saveState(true);
  }

  function completeBreak(): void {
    notify('休息结束，开始下一个番茄');
    playTone('breakEnd');
    resetToIdleFocus();
  }

  function skipBreak(): void {
    if (mode.value === 'focus') return;
    recordSession('breakSkipped', 0);
    resetToIdleFocus();
  }

  function extendBreak(): boolean {
    if (mode.value === 'focus') return false;
    if (breakExtendCount.value >= 3) return false;
    breakExtendCount.value += 1;
    remainingSeconds.value += 5 * 60;
    totalSeconds.value += 5 * 60;
    saveState(true);
    return true;
  }

  function stop(): void {
    if (mode.value === 'focus') {
      finalizeFocusSession('completed', true);
      return;
    }
    skipBreak();
  }

  function setTask(taskId: number, taskTitle: string): boolean {
    const switchingTask = currentTaskId.value !== null && currentTaskId.value !== taskId;
    if (!idle.value && switchingTask) {
      return false;
    }
    currentTaskId.value = taskId;
    currentTaskTitle.value = taskTitle;
    saveState(true);
    return true;
  }

  function clearTask(): boolean {
    if (!idle.value && currentTaskId.value !== null) {
      return false;
    }
    currentTaskId.value = null;
    currentTaskTitle.value = null;
    saveState(true);
    return true;
  }

  function hydrateFromStorage(): void {
    totalSeconds.value = getDefaultSeconds('focus');
    remainingSeconds.value = totalSeconds.value;
    elapsedSeconds.value = 0;
    const restored = loadState();
    if (!restored) {
      saveState(true);
      return;
    }

    pomodoroDateKey.value = restored.pomodoroDateKey || getTodayKey();
    completedPomodoros.value = pomodoroDateKey.value === getTodayKey() ? restored.completedPomodoros : 0;
    mode.value = restored.mode || 'focus';
    timerKind.value = restored.timerKind || 'countdown';
    totalSeconds.value = restored.totalSeconds || getDefaultSeconds(mode.value);
    remainingSeconds.value = restored.remainingSeconds || totalSeconds.value;
    elapsedSeconds.value = restored.elapsedSeconds || 0;
    breakExtendCount.value = restored.breakExtendCount || 0;
    currentTaskId.value = restored.currentTaskId ?? null;
    currentTaskTitle.value = restored.currentTaskTitle ?? null;
    startedAt.value = restored.startedAt ?? null;
    lastTickAt.value = restored.lastTickAt ?? null;
    pauseStartedAt.value = restored.pauseStartedAt ?? null;
    pauseDurationSeconds.value = restored.pauseDurationSeconds ?? 0;
    accumulatedPauseMs.value = restored.accumulatedPauseMs ?? 0;

    if (restored.status === 'running') {
      const elapsed = restored.lastTickAt ? Math.max(0, Math.floor((Date.now() - restored.lastTickAt) / 1000)) : 0;
      if (mode.value === 'focus' && timerKind.value === 'countdown') {
        remainingSeconds.value = Math.max(0, remainingSeconds.value - elapsed);
        if (remainingSeconds.value <= 0) {
          finalizeFocusSession('completed', true);
          return;
        }
      } else if (mode.value === 'focus' && timerKind.value === 'countup') {
        elapsedSeconds.value += elapsed;
      } else {
        remainingSeconds.value = Math.max(0, remainingSeconds.value - elapsed);
        if (remainingSeconds.value <= 0) {
          completeBreak();
          return;
        }
      }
      status.value = 'paused';
      pauseStartedAt.value = Date.now();
      awaitingRecovery.value = true;
      recoveryTargetStatus.value = 'running';
      startTicker();
      setTimeout(promptRecovery, 0);
    } else if (restored.status === 'paused') {
      status.value = 'paused';
      const pausedSeconds = pauseStartedAt.value ? Math.floor((Date.now() - pauseStartedAt.value) / 1000) : pauseDurationSeconds.value;
      pauseDurationSeconds.value = pausedSeconds;
      pauseWarning.value = pausedSeconds >= PAUSE_WARNING_SECONDS;
      awaitingRecovery.value = true;
      recoveryTargetStatus.value = 'paused';
      startTicker();
      setTimeout(promptRecovery, 0);
    } else {
      status.value = 'idle';
    }

    saveState(true);
  }

  function promptRecovery(): void {
    if (!awaitingRecovery.value) return;
    const confirmResume = window.confirm('检测到未完成的番茄钟，是否继续？');
    awaitingRecovery.value = false;
    if (!confirmResume) {
      resetToIdleFocus();
      return;
    }
    if (recoveryTargetStatus.value === 'running') {
      resume();
    } else {
      saveState(true);
    }
    recoveryTargetStatus.value = null;
  }

  hydrateFromStorage();

  watch(status, (newStatus) => {
    if (newStatus === 'idle') {
      stopTicker();
    } else {
      startTicker();
    }
  });

  return {
    status,
    mode,
    timerKind,
    remainingSeconds,
    elapsedSeconds,
    totalSeconds,
    completedPomodoros,
    currentTaskId,
    currentTaskTitle,
    breakExtendCount,
    pauseWarning,
    pauseDurationSeconds,
    awaitingRecovery,
    running,
    paused,
    idle,
    display,
    progress,
    modeLabel,
    pauseExceededLimit,
    setTask,
    clearTask,
    setMode,
    setTimerKind,
    start,
    pause,
    resume,
    skipBreak,
    extendBreak,
    stop,
    resetToIdleFocus
  };
});
