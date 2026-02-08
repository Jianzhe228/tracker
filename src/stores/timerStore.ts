import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

export type TimerMode = 'focus' | 'shortBreak' | 'longBreak';
export type TimerStatus = 'idle' | 'running' | 'paused';

export const useTimerStore = defineStore('timer', () => {
  const status = ref<TimerStatus>('idle');
  const mode = ref<TimerMode>('focus');
  const remainingSeconds = ref(25 * 60);
  const totalSeconds = ref(25 * 60);
  const completedPomodoros = ref(0);
  const currentTaskId = ref<number | null>(null);
  const currentTaskTitle = ref<string | null>(null);

  let intervalId: ReturnType<typeof setInterval> | null = null;

  const running = computed(() => status.value === 'running');
  const paused = computed(() => status.value === 'paused');
  const idle = computed(() => status.value === 'idle');

  const display = computed(() => {
    const min = Math.floor(remainingSeconds.value / 60)
      .toString()
      .padStart(2, '0');
    const sec = (remainingSeconds.value % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  });

  const progress = computed(() => {
    if (totalSeconds.value === 0) return 0;
    return ((totalSeconds.value - remainingSeconds.value) / totalSeconds.value) * 100;
  });

  const modeLabel = computed(() => {
    switch (mode.value) {
      case 'focus': return '专注';
      case 'shortBreak': return '短休息';
      case 'longBreak': return '长休息';
    }
  });

  function setTask(taskId: number, taskTitle: string): void {
    currentTaskId.value = taskId;
    currentTaskTitle.value = taskTitle;
  }

  function clearTask(): void {
    currentTaskId.value = null;
    currentTaskTitle.value = null;
  }

  function setMode(newMode: TimerMode): void {
    mode.value = newMode;
    switch (newMode) {
      case 'focus':
        totalSeconds.value = 25 * 60;
        break;
      case 'shortBreak':
        totalSeconds.value = 5 * 60;
        break;
      case 'longBreak':
        totalSeconds.value = 15 * 60;
        break;
    }
    remainingSeconds.value = totalSeconds.value;
  }

  function start(): void {
    if (status.value === 'running') return;
    status.value = 'running';

    intervalId = setInterval(() => {
      if (remainingSeconds.value > 0) {
        remainingSeconds.value--;
      } else {
        complete();
      }
    }, 1000);
  }

  function pause(): void {
    if (status.value !== 'running') return;
    status.value = 'paused';
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function resume(): void {
    if (status.value !== 'paused') return;
    start();
  }

  function stop(): void {
    status.value = 'idle';
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    setMode('focus');
  }

  function complete(): void {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }

    if (mode.value === 'focus') {
      completedPomodoros.value++;
      // Check if we need a long break (every 4 pomodoros)
      if (completedPomodoros.value % 4 === 0) {
        setMode('longBreak');
      } else {
        setMode('shortBreak');
      }
    } else {
      setMode('focus');
    }

    status.value = 'idle';
  }

  function reset(): void {
    stop();
    completedPomodoros.value = 0;
    clearTask();
  }

  // Cleanup interval on unmount
  watch(status, (newStatus) => {
    if (newStatus === 'idle' && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
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
    running,
    paused,
    idle,
    display,
    progress,
    modeLabel,
    setTask,
    clearTask,
    setMode,
    start,
    pause,
    resume,
    stop,
    complete,
    reset
  };
});
