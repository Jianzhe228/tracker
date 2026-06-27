import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useSettingsStore } from './settingsStore';
import { useUiStore } from './uiStore';
import { sendNotification } from '../services/notification';
import { playTone } from '../services/sound';
import { createFocusSession } from '../services/commands/focusSession';
import { toDateKey } from '../utils/date';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type TimerMode = 'focus' | 'shortBreak' | 'longBreak';
export type TimerStatus = 'idle' | 'running' | 'paused';
export type TimerKind = 'countdown' | 'countup';

export type TimerSegment = {
  taskId: number | null;
  taskTitle: string | null;
  /** Project snapshot at segment-open time. Avoids broken lookups when the
   *  task is later archived and lazy-loaded out of taskStore.tasks. */
  projectId: number | null;
  startedAt: number; // Date.now()
  durationMs: number; // accumulated duration in ms (finalized when segment is closed)
  closed: boolean;
  syncedToDb: boolean; // whether this segment has been saved to DB
  pauseOffsetMs: number; // accumulated pause time at the moment this segment started
  countedInToday: boolean; // whether this segment has been reflected in focusSecondsToday
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
  segments: Array<{
    taskId: number | null;
    taskTitle: string | null;
    projectId: number | null;
    startedAt: number;
    durationMs: number;
    closed: boolean;
    syncedToDb: boolean;
    pauseOffsetMs: number;
    countedInToday: boolean;
  }>;
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

const STORAGE_KEY = 'sft_timer_state_v2';
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

export const useTimerStore = defineStore('timer', () => {
  const settingsStore = useSettingsStore();
  const uiStore = useUiStore();

  const status = ref<TimerStatus>('idle');
  const mode = ref<TimerMode>('focus');
  const timerKind = ref<TimerKind>(settingsStore.timer.defaultTimerKind);
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
  const currentProjectId = ref<number | null>(null);
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
  let lastRAFAt = 0; // last timestamp from requestAnimationFrame

  const running = computed(() => status.value === 'running');
  const paused = computed(() => status.value === 'paused');
  const idle = computed(() => status.value === 'idle');

  const displaySeconds = computed(() => (timerKind.value === 'countup' ? elapsedSeconds.value : remainingSeconds.value));

  function getSegmentDurationMs(segment: TimerSegment, now = Date.now()): number {
    const completedPauseMs = Math.max(0, accumulatedPauseMs.value - segment.pauseOffsetMs);
    const ongoingPauseMs = pauseStartedAt.value ? now - pauseStartedAt.value : 0;
    return Math.max(0, now - segment.startedAt - completedPauseMs - ongoingPauseMs);
  }

  const currentSegmentFocusSeconds = computed(() => {
    const now = lastTickAt.value ?? Date.now();
    if (mode.value !== 'focus' || idle.value || segments.value.length === 0) {
      return 0;
    }

    const last = segments.value[segments.value.length - 1];
    if (!last || last.closed) {
      return 0;
    }

    return Math.max(0, Math.round(getSegmentDurationMs(last, now) / 1000));
  });

  const display = computed(() => {
    const totalSecs = displaySeconds.value;
    const hours = Math.floor(totalSecs / 3600);
    const min = Math.floor((totalSecs % 3600) / 60);
    const sec = Math.max(0, totalSecs % 60);
    if (hours > 0) {
      return `${hours}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  });

  // null for countup — no progress bar needed
  const progress = computed(() => {
    if (timerKind.value === 'countup') return null;
    if (timerKind.value === 'countdown') {
      if (totalSeconds.value <= 0) return 0;
      return Math.round(((totalSeconds.value - remainingSeconds.value) / totalSeconds.value) * 1000) / 10;
    }
    return 0;
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
    const focusMinutes = Math.max(1, Math.round(settingsStore.timer.focusMinutes || 25));
    const shortBreakMinutes = Math.max(1, Math.round(settingsStore.timer.shortBreakMinutes || 5));
    const longBreakMinutes = Math.max(1, Math.round(settingsStore.timer.longBreakMinutes || 15));
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
    last.durationMs = getSegmentDurationMs(last);
    last.closed = true;
  }

  function openNewSegment(taskId: number | null, taskTitle: string | null): void {
    segments.value.push({
      taskId,
      taskTitle,
      projectId: currentProjectId.value,
      startedAt: Date.now(),
      durationMs: 0,
      closed: false,
      syncedToDb: false,
      pauseOffsetMs: accumulatedPauseMs.value,
      countedInToday: false,
    });
  }

  function countClosedSegmentsInToday(): void {
    const todayKey = getTodayKey();

    for (const segment of segments.value) {
      if (!segment.closed || segment.countedInToday) continue;
      if (segment.durationMs <= 0) {
        segment.countedInToday = true;
        continue;
      }

      const segmentDateKey = toDateKey(new Date(segment.startedAt));
      if (segmentDateKey === todayKey) {
        focusSecondsToday.value += Math.round(segment.durationMs / 1000);
      }
      segment.countedInToday = true;
    }
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
      version: 2,
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
      segments: segments.value.map(s => ({
        taskId: s.taskId,
        taskTitle: s.taskTitle,
        projectId: s.projectId,
        startedAt: s.startedAt,
        durationMs: s.durationMs,
        closed: s.closed,
        syncedToDb: s.syncedToDb,
        pauseOffsetMs: s.pauseOffsetMs,
        countedInToday: s.countedInToday,
      })),
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
      return parsed?.version === 2 ? parsed : null;
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
    countClosedSegmentsInToday();

    // Determine the primary task_id: the task with the longest total duration across segments
    let primaryTaskId = currentTaskId.value;
    let primaryTaskTitle = currentTaskTitle.value;
    if (segments.value.length > 1) {
      const taskDurations = new Map<number | null, { durationMs: number; taskTitle: string | null }>();
      for (const seg of segments.value) {
        const prev = taskDurations.get(seg.taskId) || { durationMs: 0, taskTitle: seg.taskTitle };
        taskDurations.set(seg.taskId, {
          durationMs: prev.durationMs + seg.durationMs,
          taskTitle: prev.taskTitle ?? seg.taskTitle,
        });
      }
      let maxDuration = -1;
      for (const [tid, summary] of taskDurations) {
        if (summary.durationMs > maxDuration) {
          maxDuration = summary.durationMs;
          primaryTaskId = tid;
          primaryTaskTitle = summary.taskTitle;
        }
      }
    }

    const entry: SessionLog = {
      id: `${Date.now()}`,
      taskId: primaryTaskId,
      taskTitle: primaryTaskTitle,
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
      const sessionStartTime = segments.value[0]
        ? new Date(segments.value[0].startedAt).toISOString()
        : startedAt.value
        ? new Date(startedAt.value).toISOString()
        : new Date(Date.now() - spentSeconds * 1000).toISOString();

      const segmentsPayload = segments.value.length > 0
        ? segments.value
          .filter(seg => seg.durationMs > 0)
          .map((seg, idx) => ({
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

  function flushAllClosedSegments(): void {
    countClosedSegmentsInToday();
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
    timerKind.value = settingsStore.timer.defaultTimerKind;
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
    // Starting from paused must NOT reset segments/startedAt — that would drop
    // the already-elapsed portion from the persisted focus session. Resume instead.
    if (paused.value) {
      resume();
      return;
    }
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

  function nextBreakMode(): Extract<TimerMode, 'shortBreak' | 'longBreak'> {
    const longBreakInterval = settingsStore.timer.longBreakInterval || 4;
    const useLongBreak = completedPomodoros.value > 0 && completedPomodoros.value % longBreakInterval === 0;
    return useLongBreak ? 'longBreak' : 'shortBreak';
  }

  // After a focus countdown finishes with auto-start-break OFF, ask the user
  // whether to take a break or skip it and keep going. The confirm is rendered
  // app-globally (AppFeedbackLayer), so it shows even when the focus modal is
  // closed — the OS notification alone is easy to miss.
  async function promptBreakChoice(): Promise<void> {
    const breakMode = nextBreakMode();
    const isLong = breakMode === 'longBreak';
    const breakMinutes = isLong
      ? settingsStore.timer.longBreakMinutes
      : settingsStore.timer.shortBreakMinutes;
    const startNow = await uiStore.confirm(
      `已完成一个专注时段，是否开始${isLong ? '长' : ''}休息（${breakMinutes} 分钟）？`,
      {
        title: '🍅 专注结束',
        confirmText: '开始休息',
        cancelText: '跳过休息',
      },
    );
    // The user may have started a new timer while the dialog was open; only act
    // if we're still in the idle-focus state set right after the session ended.
    if (!idle.value || mode.value !== 'focus') return;
    if (startNow) {
      startBreakCountdown(breakMode);
    }
  }

  function finalizeFocusSession(statusLabel: SessionStatus, startBreak = true, note?: string): void {
    closeCurrentSegment();
    countClosedSegmentsInToday();

    const focusSeconds = Math.max(getDefaultSeconds('focus'), totalSeconds.value);
    const allSegmentsDurationMs = segments.value.reduce((sum, seg) => sum + seg.durationMs, 0);

    const spentSeconds = allSegmentsDurationMs > 0
      ? Math.round(allSegmentsDurationMs / 1000)
      : (timerKind.value === 'countdown'
        ? Math.max(0, totalSeconds.value - remainingSeconds.value)
        : elapsedSeconds.value);

    const pomodorosEarned = Math.max(0, spentSeconds / focusSeconds);
    completedPomodoros.value += pomodorosEarned;
    recordSession(statusLabel, spentSeconds, pomodorosEarned, note);

    if (startBreak && settingsStore.timer.autoStartBreak !== false) {
      const breakMode = nextBreakMode();
      if (settingsStore.notification.notifyFocusEnd) {
        const breakMinutes = breakMode === 'longBreak'
          ? settingsStore.timer.longBreakMinutes
          : settingsStore.timer.shortBreakMinutes;
        sendNotification({
          type: 'focusEnd',
          title: 'Tracker',
          body: `专注结束，进入${breakMode === 'longBreak' ? '长休息' : '休息'} (${breakMinutes} 分钟)`,
        });
      }
      playTone('complete');
      startBreakCountdown(breakMode);
    } else if (startBreak) {
      // autoStartBreak off: notify + sound, return to idle, then ask whether to
      // start a break or skip it and keep going.
      if (settingsStore.notification.notifyFocusEnd) {
        sendNotification({
          type: 'focusEnd',
          title: 'Tracker',
          body: '专注结束，是否开始休息？',
        });
      }
      playTone('complete');
      resetToIdleFocus();
      void promptBreakChoice();
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
    lastTickAt.value = now;
    syncDailyPomodoroCounter();

    if (running.value) {
      if (mode.value === 'focus') {
        // Always derive elapsed from wall-clock (startedAt), never accumulate delta,
        // so tab throttling/batching cannot cause drift or skip-ahead.
        const rawElapsed = now - startedAt.value! - accumulatedPauseMs.value;
        const elapsed = Math.max(0, Math.floor(rawElapsed / 1000));
        if (timerKind.value === 'countdown') {
          remainingSeconds.value = Math.max(0, totalSeconds.value - elapsed);
          if (remainingSeconds.value <= 0) {
            finalizeFocusSession('completed', true);
            return;
          }
        } else {
          // countup: no cap — can run indefinitely
          elapsedSeconds.value = elapsed;
        }
      } else {
        // break mode: mirror focus — subtract accumulated pause so resume不缩短休息
        const ongoingPauseMs = pauseStartedAt.value ? now - pauseStartedAt.value : 0;
        const rawElapsed = now - startedAt.value! - accumulatedPauseMs.value - ongoingPauseMs;
        const elapsed = Math.max(0, Math.floor(rawElapsed / 1000));
        remainingSeconds.value = Math.max(0, totalSeconds.value - elapsed);
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

  function setTask(taskId: number, taskTitle: string, projectId: number | null = null): boolean {
    const isTimerActive = !idle.value && mode.value === 'focus';
    const switchingTask = currentTaskId.value !== null && currentTaskId.value !== taskId;

    if (isTimerActive && switchingTask) {
      // Close current segment and open a new one
      closeCurrentSegment();
      countClosedSegmentsInToday();
      currentTaskId.value = taskId;
      currentTaskTitle.value = taskTitle;
      currentProjectId.value = projectId;
      openNewSegment(taskId, taskTitle);
      segmentSwitchCount.value++;
      saveState(true);
      return true;
    }

    if (isTimerActive && currentTaskId.value === null) {
      // Assigning a task mid-session (was null before)
      closeCurrentSegment();
      countClosedSegmentsInToday();
      currentTaskId.value = taskId;
      currentTaskTitle.value = taskTitle;
      currentProjectId.value = projectId;
      openNewSegment(taskId, taskTitle);
      segmentSwitchCount.value++;
      saveState(true);
      return true;
    }

    currentTaskId.value = taskId;
    currentTaskTitle.value = taskTitle;
    currentProjectId.value = projectId;
    saveState(true);
    return true;
  }

  function clearTask(): boolean {
    const isTimerActive = !idle.value && mode.value === 'focus';

    if (isTimerActive && currentTaskId.value !== null) {
      // Close current segment, open a null-task segment
      closeCurrentSegment();
      countClosedSegmentsInToday();
      currentTaskId.value = null;
      currentTaskTitle.value = null;
      currentProjectId.value = null;
      openNewSegment(null, null);
      segmentSwitchCount.value++;
      saveState(true);
      return true;
    }

    currentTaskId.value = null;
    currentTaskTitle.value = null;
    currentProjectId.value = null;
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
    timerKind.value = restored.timerKind || settingsStore.timer.defaultTimerKind || 'countdown';
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
      projectId: s.projectId,
      startedAt: s.startedAt,
      durationMs: s.durationMs,
      closed: s.closed,
      syncedToDb: s.syncedToDb,
      pauseOffsetMs: s.pauseOffsetMs,
      countedInToday: s.countedInToday,
    }));
    segmentSwitchCount.value = restored.segmentSwitchCount || 0;

    // If idle, prioritize the current default setting over persisted stale state
    if (restored.status === 'idle' && mode.value === 'focus') {
      timerKind.value = settingsStore.timer.defaultTimerKind;
      totalSeconds.value = getDefaultSeconds('focus');
      remainingSeconds.value = totalSeconds.value;
      elapsedSeconds.value = 0;
    }

    if (restored.status === 'running') {
      // Treat offline span as pause (not focus/break consumption) so stats stay clean.
      // The user will decide via promptRecovery whether to continue or discard.
      const offlineMs = restored.lastTickAt ? Math.max(0, Date.now() - restored.lastTickAt) : 0;
      accumulatedPauseMs.value += offlineMs;

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

  // Synchronize timer kind/duration with settings in real-time when idle and in
  // focus mode. focusMinutes must be watched too: settings load from the DB
  // after hydrateFromStorage has already initialized idle state with defaults.
  watch(
    () => [settingsStore.timer.defaultTimerKind, settingsStore.timer.focusMinutes] as const,
    ([newKind]) => {
      if (idle.value && mode.value === 'focus') {
        timerKind.value = newKind;
        // Also reset time values to match the new mode
        totalSeconds.value = getDefaultSeconds('focus');
        remainingSeconds.value = totalSeconds.value;
        elapsedSeconds.value = 0;
        saveState(true);
      }
    }
  );

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
    currentSegmentFocusSeconds,
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
