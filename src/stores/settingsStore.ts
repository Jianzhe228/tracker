import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { PomodoroSettings } from '../types/domain';

export const useSettingsStore = defineStore('settings', () => {
  const pomodoro = ref<PomodoroSettings>({
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15
  });

  function updatePomodoro(next: Partial<PomodoroSettings>): void {
    pomodoro.value = {
      ...pomodoro.value,
      ...next
    };
  }

  return {
    pomodoro,
    updatePomodoro
  };
});
