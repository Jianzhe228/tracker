import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useSettingsStore } from './settingsStore';
import { useUiStore } from './uiStore';
import { sendNotification } from '../services/notification';
import { createFocusSession } from '../services/commands/focusSession';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type TimerMode = 'focus' | 'shortBreak' | 'longBreak';
export type TimerStatus = 'idle' | 'running' | 'paused';
export type TimerKind = 'countdown' | 'countup';

export type TimerSegment = {
  taskId: number | null;
  taskTitle: string | null;
  startedAt: number; // Date.now()
  durationMs: number; // accumulated duration in ms (finalized when segment is closed)
  closed: boolean;
  syncedToDb: boolean; // whether this segment has been saved to DB
};

type PersistedTimerState = {
  version: number;
  status: TimerStatus;
  mode: TimerMode;
  timerKind: TimerKind;
  remainingSeconds: number;
  elapsedSeconds: number;
  totalSeconds: number;
  completedPomodoros: number;
  focusSecondsToday: number;
  pomodoroDateKey: string;
  breakExtendCount: number;
  currentTaskId: number | null;
  currentTaskTitle: string | null;
  startedAt: number | null;
  lastTickAt: number | null;
  pauseStartedAt: number | null;
  pauseDurationSeconds: number;
  accumulatedPauseMs: number;
  segments: Array<{ taskId: number | null; taskTitle: string | null; startedAt: number; durationMs: number; closed: boolean; syncedToDb: boolean }>;
  segmentSwitchCount: number;
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
  const uiStore = useUiStore();

  const status = ref<TimerStatus>('idle');
  const mode = ref<TimerMode>('focus');
  const timerKind = ref<TimerKind>('countdown');
  const totalSeconds = ref<number>(0);
  const remainingSeconds = ref<number>(0);
  const elapsedSeconds = ref<number>(0);
  const completedPomodoros = ref(0.0);
  const focusSecondsToday = ref(0);
  const pomodoroDateKey = ref(getTodayKey());
  const breakExtendCount = ref(0);
  const pauseWarning = ref(false);
  const pauseDurationSeconds = ref(0);
  const accumulatedPauseMs = ref(0);
  const currentTaskId = ref<number | null>(null);
  const currentTaskTitle = ref<string | null>(null);
  const awaitingRecovery = ref(false);
  const recoveryTargetStatus = ref<TimerStatus | null>(null);
  const lastFocusSessionSavedAt = ref<number>(0);
  const segments = ref<TimerSegment[]>([]);
  const segmentSwitchCount = ref(0);

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
    const baseline = Math.max(60, totalSeconds.value);
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
      focusSecondsToday.value = 0;
    }
  }

  function closeCurrentSegment(): void {
    const segs = segments.value;
    if (segs.length === 0) return;
    const last = segs[segs.length - 1];
    if (last.closed) return;
    // Calculate duration: time from startedAt to now, minus any current pause
    const now = Date.now();
    let elapsed = now - last.startedAt;
    // Subtract current ongoing pause if paused
    if (pauseStartedAt.value) {
      elapsed -= (now - pauseStartedAt.value);
    }
    last.durationMs = Math.max(0, elapsed);
    last.closed = true;
  }

  function openNewSegment(taskId: number | null, taskTitle: string | null): void {
    segments.value.push({
      taskId,
      taskTitle,
      startedAt: Date.now(),
      durationMs: 0,
      closed: false,
      syncedToDb: false,
    });
  }

  function resetSegments(): void {
    segments.value = [];
    segmentSwitchCount.value = 0;
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
      focusSecondsToday: focusSecondsToday.value,
      pomodoroDateKey: pomodoroDateKey.value,
      breakExtendCount: breakExtendCount.value,
      currentTaskId: currentTaskId.value,
      currentTaskTitle: currentTaskTitle.value,
      startedAt: startedAt.value,
      lastTickAt: lastTickAt.value,
      pauseStartedAt: pauseStartedAt.value,
      pauseDurationSeconds: pauseDurationSeconds.value,
      accumulatedPauseMs: accumulatedPauseMs.value,
      segments: segments.value.map(s => ({ taskId: s.taskId, taskTitle: s.taskTitle, startedAt: s.startedAt, durationMs: s.durationMs, closed: s.closed, syncedToDb: s.syncedToDb })),
      segmentSwitchCount: segmentSwitchCount.value,
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

  function recordSession(statusLabel: SessionStatus, spentSeconds: number, pomodoros: number, note?: string): void {
    const finishedAt = new Date().toISOString();

    // Close last segment before building payload
    closeCurrentSegment();

    // Determine the primary task_id: the task with the longest total duration across segments
    let primaryTaskId = currentTaskId.value;
    if (segments.value.length > 1) {
      const taskDurations = new Map<number | null, number>();
      for (const seg of segments.value) {
        const prev = taskDurations.get(seg.taskId) || 0;
        taskDurations.set(seg.taskId, prev + seg.durationMs);
      }
      let maxDuration = -1;
      for (const [tid, dur] of taskDurations) {
        if (dur > maxDuration) {
          maxDuration = dur;
          primaryTaskId = tid;
        }
      }
    }

    const entry: SessionLog = {
      id: `${Date.now()}`,
      taskId: primaryTaskId,
      taskTitle: currentTaskTitle.value,
      status: statusLabel,
      note,
      finishedAt,
      mode: mode.value,
      spentSeconds,
      pomodoros
    };
    appendSessionLog(entry);

    // Persist focus sessions to SQLite (fire-and-forget)
    if (isTauri && spentSeconds > 0 && mode.value === 'focus') {
      const sessionStartTime = startedAt.value
        ? new Date(startedAt.value).toISOString()
        : new Date(Date.now() - spentSeconds * 1000).toISOString();

      // Build segments payload (only unsynced segments - synced ones already saved individually)
      const unsyncedSegments = segments.value.filter(seg => !seg.syncedToDb);
      const segmentsPayload = unsyncedSegments.length > 0
        ? unsyncedSegments.map((seg, idx) => ({
            taskId: seg.taskId,
            startTime: new Date(seg.startedAt).toISOString(),
            durationSeconds: Math.max(0, Math.round(seg.durationMs / 1000)),
            sortOrder: idx,
          }))
        : undefined;

      createFocusSession({
        taskId: primaryTaskId,
        startTime: sessionStartTime,
        endTime: finishedAt,
        durationSeconds: spentSeconds,
        type: 'focus',
        status: statusLabel,
        interruptionReason: note,
        pomodoroCount: pomodoros,
        segments: segmentsPayload,
      })
        .then(() => {
          lastFocusSessionSavedAt.value = Date.now();
        })
        .catch((err) => {
          console.warn('[timer] failed to persist focus session to SQLite', err);
        });
    }

    resetSegments();
  }

  // Flush a closed segment to the database immediately
  function flushSegmentToDb(seg: TimerSegment): void {
    if (!isTauri || seg.durationMs <= 0 || seg.syncedToDb) return;
    const durationSeconds = Math.max(0, Math.round(seg.durationMs / 1000));
    const endTime = new Date(seg.startedAt + seg.durationMs).toISOString();
    const startTime = new Date(seg.startedAt).toISOString();

    // Mark as synced immediately to prevent double-saving in recordSession
    seg.syncedToDb = true;

    createFocusSession({
      taskId: seg.taskId,
      startTime,
      endTime,
      durationSeconds,
      type: 'focus',
      status: 'stopped',
      pomodoroCount: Math.max(0, durationSeconds / Math.max(60, totalSeconds.value)),
      segments: [{
        taskId: seg.taskId,
        startTime,
        durationSeconds,
        sortOrder: 0,
      }],
    })
      .then(() => {
        // Update focusSecondsToday to trigger chart refresh
        focusSecondsToday.value += durationSeconds;
      })
      .catch((err) => {
        console.warn('[timer] failed to flush segment to DB', err);
      });
  }

  // Flush all unsaved closed segments to DB
  function flushAllClosedSegments(): void {
    for (const seg of segments.value) {
      if (seg.closed && !seg.syncedToDb && seg.durationMs > 0) {
        flushSegmentToDb(seg);
      }
    }
  }

  let lastFlushAt = 0;
  const FLUSH_INTERVAL_MS = 60_000; // Flush every 60 seconds during active timing

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
    resetSegments();
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
    // Initialize segments for focus mode
    if (mode.value === 'focus') {
      resetSegments();
      openNewSegment(currentTaskId.value, currentTaskTitle.value);
    }
    lastFlushAt = Date.now();
    startTicker();
    if (mode.value === 'focus') {
      if (settingsStore.notification.notifyFocusStart) {
        sendNotification({
          type: 'focusStart',
          title: 'Tracker',
          body: `开始专注：${currentTaskTitle.value || '专注任务'}`,
        });
      }
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
    // First flush any unsynced closed segments (e.g., from task switches)
    // This is async - we just trigger it and move on
    flushAllClosedSegments();

    const focusSeconds = Math.max(60, totalSeconds.value);
    // Calculate total spent from all segments
    const allSegmentsDurationMs = segments.value.reduce((sum, seg) => sum + seg.durationMs, 0);

    // For spentSeconds: use segments total, falling back to elapsed if no segments
    const spentSeconds = allSegmentsDurationMs > 0
      ? Math.round(allSegmentsDurationMs / 1000)
      : (timerKind.value === 'countdown'
        ? Math.max(0, totalSeconds.value - remainingSeconds.value)
        : elapsedSeconds.value);

    // NOTE: flushAllClosedSegments will update focusSecondsToday asynchronously via .then()
    // We do NOT add unsyncedDuration here to avoid double-counting
    const pomodorosEarned = Math.max(0, spentSeconds / focusSeconds);
    completedPomodoros.value += pomodorosEarned;
    recordSession(statusLabel, spentSeconds, pomodorosEarned, note);

    const longBreakInterval = settingsStore.timer.longBreakInterval || 4;
    if (startBreak && settingsStore.timer.autoStartBreak !== false) {
      const useLongBreak = completedPomodoros.value > 0 && completedPomodoros.value % longBreakInterval === 0;
      const nextBreak: TimerMode = useLongBreak ? 'longBreak' : 'shortBreak';
      if (settingsStore.notification.notifyFocusEnd) {
        const breakMinutes = useLongBreak
          ? settingsStore.timer.longBreakMinutes
          : settingsStore.timer.shortBreakMinutes;
        sendNotification({
          type: 'focusEnd',
          title: 'Tracker',
          body: `专注结束，进入${useLongBreak ? '长休息' : '休息'} (${breakMinutes} 分钟)`,
        });
      }
      playTone('complete');
      startBreakCountdown(nextBreak);
    } else if (startBreak) {
      // autoStartBreak is off: notify and go idle
      if (settingsStore.notification.notifyFocusEnd) {
        sendNotification({
          type: 'focusEnd',
          title: 'Tracker',
          body: '专注结束',
        });
      }
      playTone('complete');
      resetToIdleFocus();
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
      // Periodic flush: save closed segments to DB every FLUSH_INTERVAL_MS
      if (now - lastFlushAt >= FLUSH_INTERVAL_MS) {
        flushAllClosedSegments();
        lastFlushAt = now;
      }
    } else if (paused.value && pauseStartedAt.value) {
      pauseDurationSeconds.value = Math.max(
        pauseDurationSeconds.value,
        Math.floor((now - pauseStartedAt.value) / 1000)
      );
      pauseWarning.value = pauseDurationSeconds.value >= PAUSE_WARNING_SECONDS;
      if (mode.value === 'focus' && pauseDurationSeconds.value >= PAUSE_FORCE_STOP_SECONDS) {
        sendNotification({
          type: 'pauseTimeout',
          title: 'Tracker',
          body: '暂停超时，已自动结束本次计时',
        });
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
    if (settingsStore.notification.notifyBreakEnd) {
      sendNotification({
        type: 'breakEnd',
        title: 'Tracker',
        body: '休息结束，开始下一个番茄',
      });
    }
    playTone('breakEnd');
    if (settingsStore.timer.autoStartNext) {
      resetToIdleFocus();
      start();
    } else {
      resetToIdleFocus();
    }
  }

  function skipBreak(): void {
    if (mode.value === 'focus') return;
    recordSession('breakSkipped', 0, 0);
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
      finalizeFocusSession('stopped', false, 'manual_stop');
      return;
    }
    skipBreak();
  }

  function setTask(taskId: number, taskTitle: string): boolean {
    const isTimerActive = !idle.value && mode.value === 'focus';
    const switchingTask = currentTaskId.value !== null && currentTaskId.value !== taskId;

    if (isTimerActive && switchingTask) {
      // Close current segment and open a new one
      closeCurrentSegment();
      flushAllClosedSegments(); // Save closed segment to DB immediately
      currentTaskId.value = taskId;
      currentTaskTitle.value = taskTitle;
      openNewSegment(taskId, taskTitle);
      segmentSwitchCount.value++;
      saveState(true);
      return true;
    }

    if (isTimerActive && currentTaskId.value === null) {
      // Assigning a task mid-session (was null before)
      closeCurrentSegment();
      flushAllClosedSegments(); // Save closed segment to DB immediately
      currentTaskId.value = taskId;
      currentTaskTitle.value = taskTitle;
      openNewSegment(taskId, taskTitle);
      segmentSwitchCount.value++;
      saveState(true);
      return true;
    }

    currentTaskId.value = taskId;
    currentTaskTitle.value = taskTitle;
    saveState(true);
    return true;
  }

  function clearTask(): boolean {
    const isTimerActive = !idle.value && mode.value === 'focus';

    if (isTimerActive && currentTaskId.value !== null) {
      // Close current segment, open a null-task segment
      closeCurrentSegment();
      flushAllClosedSegments(); // Save closed segment to DB immediately
      currentTaskId.value = null;
      currentTaskTitle.value = null;
      openNewSegment(null, null);
      segmentSwitchCount.value++;
      saveState(true);
      return true;
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
    focusSecondsToday.value = pomodoroDateKey.value === getTodayKey() ? (restored.focusSecondsToday || 0) : 0;
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
    segments.value = (restored.segments || []).map(s => ({
      taskId: s.taskId,
      taskTitle: s.taskTitle,
      startedAt: s.startedAt,
      durationMs: s.durationMs,
      closed: s.closed,
      syncedToDb: s.syncedToDb ?? false,
    }));
    segmentSwitchCount.value = restored.segmentSwitchCount || 0;

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
      setTimeout(() => {
        void promptRecovery();
      }, 0);
    } else if (restored.status === 'paused') {
      status.value = 'paused';
      const pausedSeconds = pauseStartedAt.value ? Math.floor((Date.now() - pauseStartedAt.value) / 1000) : pauseDurationSeconds.value;
      pauseDurationSeconds.value = pausedSeconds;
      pauseWarning.value = pausedSeconds >= PAUSE_WARNING_SECONDS;
      awaitingRecovery.value = true;
      recoveryTargetStatus.value = 'paused';
      startTicker();
      setTimeout(() => {
        void promptRecovery();
      }, 0);
    } else {
      status.value = 'idle';
    }

    saveState(true);
  }

  async function promptRecovery(): Promise<void> {
    if (!awaitingRecovery.value) return;
    const confirmResume = await uiStore.confirm('检测到未完成的番茄钟，是否继续？', {
      title: '恢复计时',
      confirmText: '继续',
      cancelText: '放弃',
    });
    if (!awaitingRecovery.value) return;
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
    focusSecondsToday,
    lastFocusSessionSavedAt,
    currentTaskId,
    currentTaskTitle,
    breakExtendCount,
    pauseWarning,
    pauseDurationSeconds,
    awaitingRecovery,
    segments,
    segmentSwitchCount,
    running,
    paused,
    idle,
    display,
    progress,
    modeLabel,
    pauseExceededLimit,
    setTask,
    clearTask,
    hydrateFromStorage,
    setMode,
    setTimerKind,
    start,
    pause,
    resume,
    skipBreak,
    extendBreak,
    stop,
    resetToIdleFocus,
    // Exposed for testing
    finalizeFocusSession,
    flushAllClosedSegments,
    syncDailyPomodoroCounter,
  };
});
