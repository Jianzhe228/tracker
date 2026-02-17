import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { PomodoroSettings } from '../types/domain';
import { setSetting } from '../services/commands/settings';

const isTauri = '__TAURI_INTERNALS__' in window;

export const useSettingsStore = defineStore('settings', () => {
  const pomodoro = ref<PomodoroSettings>({
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15
  });

  function loadFromData(entries: { key: string; value: string }[]): void {
    for (const { key, value } of entries) {
      switch (key) {
        case 'focusMinutes':
          pomodoro.value.focusMinutes = Number(value);
          break;
        case 'shortBreakMinutes':
          pomodoro.value.shortBreakMinutes = Number(value);
          break;
        case 'longBreakMinutes':
          pomodoro.value.longBreakMinutes = Number(value);
          break;
      }
    }
  }

  async function updatePomodoro(next: Partial<PomodoroSettings>): Promise<void> {
    pomodoro.value = {
      ...pomodoro.value,
      ...next
    };
    if (isTauri) {
      const promises: Promise<void>[] = [];
      if (next.focusMinutes !== undefined) {
        promises.push(setSetting('focusMinutes', String(next.focusMinutes)));
      }
      if (next.shortBreakMinutes !== undefined) {
        promises.push(setSetting('shortBreakMinutes', String(next.shortBreakMinutes)));
      }
      if (next.longBreakMinutes !== undefined) {
        promises.push(setSetting('longBreakMinutes', String(next.longBreakMinutes)));
      }
      await Promise.all(promises).catch(console.error);
    }
  }

  return {
    pomodoro,
    loadFromData,
    updatePomodoro
  };
});
