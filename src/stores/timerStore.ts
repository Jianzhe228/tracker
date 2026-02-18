import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useSettingsStore } from './settingsStore';
import { notify } from '../services/notification';

export type TimerMode = 'focus' | 'shortBreak' | 'longBreak';
export type TimerStatus = 'idle' | 'running' | 'paused';

type PersistedTimerState = {
  version: number;
  status: TimerStatus;
  mode: TimerMode;
  remainingSeconds: number;
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

const STORAGE_KEY = 'sft_timer_state_v1';
const SESSION_LOG_KEY = 'sft_timer_sessions';
const SECOND = 1000;
const PAUSE_WARNING_SECONDS = 30 * 60;
const PAUSE_FORCE_ABANDON_SECONDS = 2 * 60 * 60;

function getTodayKey(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type SessionStatus = 'completed' | 'abandoned' | 'breakSkipped';

type SessionLog = {
  id: string;
  taskId: number | null;
  taskTitle: string | null;
  status: SessionStatus;
  reason?: string;
  finishedAt: string;
  mode: TimerMode;
  spentSeconds: number;
};

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
  const totalSeconds = ref<number>(0);
  const remainingSeconds = ref<number>(0);
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

  const running = computed(() => status.value === 'running');
  const paused = computed(() => status.value === 'paused');
  const idle = computed(() => status.value === 'idle');

  const display = computed(() => {
    const min = Math.floor(remainingSeconds.value / 60)
      .toString()
      .padStart(2, '0');
    const sec = Math.max(0, remainingSeconds.value % 60)
      .toString()
      .padStart(2, '0');
    return `${min}:${sec}`;
  });

  const progress = computed(() => {
    if (totalSeconds.value <= 0) return 0;
    return ((totalSeconds.value - remainingSeconds.value) / totalSeconds.value) * 100;
  });

  const modeLabel = computed(() => {
    switch (mode.value) {
      case 'focus': return '专注';
      case 'shortBreak': return '短休息';
      case 'longBreak': return '长休息';
    }
  });

  const pauseExceededLimit = computed(() => pauseDurationSeconds.value >= PAUSE_FORCE_ABANDON_SECONDS);

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

  function saveState(): void {
    const payload: PersistedTimerState = {
      version: 1,
      status: status.value,
      mode: mode.value,
      remainingSeconds: remainingSeconds.value,
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

    if (typeof localStorage === 'undefined') return;
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

  function recordSession(statusLabel: SessionStatus, reason?: string): void {
    const finishedAt = new Date().toISOString();
    const spentSeconds = Math.max(0, totalSeconds.value - remainingSeconds.value);
    const entry: SessionLog = {
      id: `${Date.now()}`,
      taskId: currentTaskId.value,
      taskTitle: currentTaskTitle.value,
      status: statusLabel,
      reason: reason || undefined,
      finishedAt,
      mode: mode.value,
      spentSeconds
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
    totalSeconds.value = getDefaultSeconds('focus');
    remainingSeconds.value = totalSeconds.value;
    breakExtendCount.value = 0;
    startedAt.value = null;
    lastTickAt.value = null;
    resetPauseTracking();
    accumulatedPauseMs.value = 0;
    awaitingRecovery.value = false;
    recoveryTargetStatus.value = null;
    stopTicker();
    saveState();
  }

  function handleAutoAbandon(reason: string): void {
    recordSession('abandoned', reason);
    resetToIdleFocus();
    notify(`专注已中断（${reason === 'pause_timeout' ? '暂停超时' : '自动放弃' }）`);
  }

  function setMode(newMode: TimerMode): void {
    if (!idle.value) return;
    mode.value = newMode;
    totalSeconds.value = getDefaultSeconds(newMode);
    remainingSeconds.value = totalSeconds.value;
    breakExtendCount.value = 0;
    saveState();
  }

  function ensureProgressBaseline(): void {
    if (totalSeconds.value <= 0) {
      totalSeconds.value = getDefaultSeconds(mode.value);
    }
    if (remainingSeconds.value <= 0) {
      remainingSeconds.value = totalSeconds.value;
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
    saveState();
  }

  function pause(): void {
    if (!running.value) return;
    status.value = 'paused';
    pauseStartedAt.value = Date.now();
    pauseDurationSeconds.value = 0;
    pauseWarning.value = false;
    startTicker();
    saveState();
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
    saveState();
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
      if (deltaSeconds > 0) {
        remainingSeconds.value = Math.max(0, remainingSeconds.value - deltaSeconds);
      }
      if (remainingSeconds.value <= 0) {
        handleTimerComplete();
        return;
      }
    } else if (paused.value) {
      if (pauseStartedAt.value) {
        pauseDurationSeconds.value = Math.max(
          pauseDurationSeconds.value,
          Math.floor((now - pauseStartedAt.value) / 1000)
        );
        pauseWarning.value = pauseDurationSeconds.value >= PAUSE_WARNING_SECONDS;
        if (pauseDurationSeconds.value >= PAUSE_FORCE_ABANDON_SECONDS) {
          handleAutoAbandon('pause_timeout');
          return;
        }
      }
    }

    saveState();
  }

  function handleTimerComplete(): void {
    if (mode.value === 'focus') {
      completeFocus();
    } else {
      completeBreak();
    }
  }

  function completeFocus(): void {
    accumulatedPauseMs.value = 0;
    resetPauseTracking();
    syncDailyPomodoroCounter();
    completedPomodoros.value += 1;
    const useLongBreak = completedPomodoros.value > 0 && completedPomodoros.value % 4 === 0;
    const nextBreak: TimerMode = useLongBreak ? 'longBreak' : 'shortBreak';
    notify(`专注完成！${useLongBreak ? '长休息 15 分钟' : '休息 5 分钟'}`);
    playTone('complete');
    recordSession('completed');
    startBreak(nextBreak);
  }

  function startBreak(nextMode: Extract<TimerMode, 'shortBreak' | 'longBreak'>): void {
    mode.value = nextMode;
    totalSeconds.value = getDefaultSeconds(nextMode);
    remainingSeconds.value = totalSeconds.value;
    status.value = 'running';
    startedAt.value = Date.now();
    lastTickAt.value = startedAt.value;
    breakExtendCount.value = 0;
    resetPauseTracking();
    accumulatedPauseMs.value = 0;
    startTicker();
    saveState();
  }

  function completeBreak(): void {
    notify('休息结束，开始下一个番茄');
    playTone('breakEnd');
    resetToIdleFocus();
  }

  function skipBreak(): void {
    if (mode.value === 'focus') return;
    recordSession('breakSkipped');
    resetToIdleFocus();
  }

  function extendBreak(): boolean {
    if (mode.value === 'focus') return false;
    if (breakExtendCount.value >= 3) return false;
    breakExtendCount.value += 1;
    remainingSeconds.value += 5 * 60;
    totalSeconds.value += 5 * 60;
    saveState();
    return true;
  }

  function abandon(reason?: string): void {
    recordSession('abandoned', reason);
    resetToIdleFocus();
    notify(`专注已中断${reason ? `：${reason}` : ''}`);
  }

  function setTask(taskId: number, taskTitle: string): boolean {
    const switchingTask = currentTaskId.value !== null && currentTaskId.value !== taskId;
    if (!idle.value && switchingTask) {
      return false;
    }
    currentTaskId.value = taskId;
    currentTaskTitle.value = taskTitle;
    saveState();
    return true;
  }

  function clearTask(): boolean {
    if (!idle.value && currentTaskId.value !== null) {
      return false;
    }
    currentTaskId.value = null;
    currentTaskTitle.value = null;
    saveState();
    return true;
  }

  function hydrateFromStorage(): void {
    totalSeconds.value = getDefaultSeconds('focus');
    remainingSeconds.value = totalSeconds.value;
    const restored = loadState();
    if (!restored) {
      saveState();
      return;
    }

    pomodoroDateKey.value = restored.pomodoroDateKey || getTodayKey();
    completedPomodoros.value = pomodoroDateKey.value === getTodayKey() ? restored.completedPomodoros : 0;
    mode.value = restored.mode || 'focus';
    totalSeconds.value = restored.totalSeconds || getDefaultSeconds(mode.value);
    remainingSeconds.value = restored.remainingSeconds || totalSeconds.value;
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
      const nextRemaining = remainingSeconds.value - elapsed;
      if (nextRemaining <= 0) {
        status.value = 'running';
        remainingSeconds.value = 0;
        handleTimerComplete();
        return;
      }
      remainingSeconds.value = nextRemaining;
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
      if (pausedSeconds >= PAUSE_FORCE_ABANDON_SECONDS) {
        handleAutoAbandon('pause_timeout');
        return;
      }
      awaitingRecovery.value = true;
      recoveryTargetStatus.value = 'paused';
      startTicker();
      setTimeout(promptRecovery, 0);
    } else {
      status.value = 'idle';
    }

    saveState();
  }

  function promptRecovery(): void {
    if (!awaitingRecovery.value) return;
    const confirmResume = window.confirm('检测到未完成的番茄钟，是否继续？');
    awaitingRecovery.value = false;
    if (!confirmResume) {
      abandon('放弃未完成的番茄');
      return;
    }
    if (recoveryTargetStatus.value === 'running') {
      resume();
    } else if (recoveryTargetStatus.value === 'paused') {
      startTicker();
      saveState();
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
    remainingSeconds,
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
    start,
    pause,
    resume,
    skipBreak,
    extendBreak,
    abandon,
    resetToIdleFocus
  };
});
