import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { TimerSettings, NotificationSettings } from '../types/domain';
import { setSetting } from '../services/commands/settings';

const isTauri = '__TAURI_INTERNALS__' in window;

export interface WebDavSettings {
  url: string;
  username: string;
  password: string;
  path: string;
  autoSync: boolean;
  syncInterval: number;
}

export interface AiSettings {
  endpoint: string;
  apiKey: string;
  model: string;
}

export const useSettingsStore = defineStore('settings', () => {
  const timer = ref<TimerSettings>({
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    longBreakInterval: 4,
    autoStartBreak: false,
    autoStartNext: false,
    defaultTimerKind: 'countdown',
  });

  // Keep backward-compatible alias
  const pomodoro = timer;

  const notification = ref<NotificationSettings>({
    notifyFocusStart: true,
    notifyFocusEnd: true,
    notifyBreakEnd: true,
    notifyDeadline: false,
  });

  const webdav = ref<WebDavSettings>({
    url: '',
    username: '',
    password: '',
    path: '/tracker/',
    autoSync: false,
    syncInterval: 30,
  });

  const ai = ref<AiSettings>({
    endpoint: '',
    apiKey: '',
    model: '',
  });

  const closeToTray = ref(true);

  function loadFromData(entries: { key: string; value: string }[]): void {
    for (const { key, value } of entries) {
      switch (key) {
        case 'focusMinutes':
          timer.value.focusMinutes = Number(value);
          break;
        case 'shortBreakMinutes':
          timer.value.shortBreakMinutes = Number(value);
          break;
        case 'longBreakMinutes':
          timer.value.longBreakMinutes = Number(value);
          break;
        case 'longBreakInterval':
          timer.value.longBreakInterval = Number(value);
          break;
        case 'autoStartBreak':
          timer.value.autoStartBreak = value === 'true';
          break;
        case 'autoStartNext':
          timer.value.autoStartNext = value === 'true';
          break;
        case 'defaultTimerKind':
          if (value === 'countup' || value === 'countdown') {
            timer.value.defaultTimerKind = value;
          }
          break;
        case 'notifyFocusStart':
          notification.value.notifyFocusStart = value === 'true';
          break;
        case 'notifyFocusEnd':
          notification.value.notifyFocusEnd = value === 'true';
          break;
        case 'notifyBreakEnd':
          notification.value.notifyBreakEnd = value === 'true';
          break;
        case 'notifyDeadline':
          notification.value.notifyDeadline = value === 'true';
          break;
        case 'webdavUrl':
          webdav.value.url = value;
          break;
        case 'webdavUsername':
          webdav.value.username = value;
          break;
        case 'webdavPassword':
          webdav.value.password = value;
          break;
        case 'webdavPath':
          webdav.value.path = value;
          break;
        case 'webdavAutoSync':
          webdav.value.autoSync = value === 'true';
          break;
        case 'webdavSyncInterval':
          webdav.value.syncInterval = Number(value);
          break;
        case 'aiEndpoint':
          ai.value.endpoint = value;
          break;
        case 'aiApiKey':
          ai.value.apiKey = value;
          break;
        case 'aiModel':
          ai.value.model = value;
          break;
        case 'closeToTray':
          closeToTray.value = value !== 'false';
          break;
      }
    }
  }

  async function updatePomodoro(next: Partial<TimerSettings>): Promise<void> {
    timer.value = {
      ...timer.value,
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
      if (next.longBreakInterval !== undefined) {
        promises.push(setSetting('longBreakInterval', String(next.longBreakInterval)));
      }
      if (next.autoStartBreak !== undefined) {
        promises.push(setSetting('autoStartBreak', String(next.autoStartBreak)));
      }
      if (next.autoStartNext !== undefined) {
        promises.push(setSetting('autoStartNext', String(next.autoStartNext)));
      }
      if (next.defaultTimerKind !== undefined) {
        promises.push(setSetting('defaultTimerKind', next.defaultTimerKind));
      }
      await Promise.all(promises).catch(console.error);
    }
  }

  async function updateNotification(next: Partial<NotificationSettings>): Promise<void> {
    notification.value = {
      ...notification.value,
      ...next
    };
    if (isTauri) {
      const promises: Promise<void>[] = [];
      if (next.notifyFocusStart !== undefined) {
        promises.push(setSetting('notifyFocusStart', String(next.notifyFocusStart)));
      }
      if (next.notifyFocusEnd !== undefined) {
        promises.push(setSetting('notifyFocusEnd', String(next.notifyFocusEnd)));
      }
      if (next.notifyBreakEnd !== undefined) {
        promises.push(setSetting('notifyBreakEnd', String(next.notifyBreakEnd)));
      }
      if (next.notifyDeadline !== undefined) {
        promises.push(setSetting('notifyDeadline', String(next.notifyDeadline)));
      }
      await Promise.all(promises).catch(console.error);
    }
  }

  async function updateWebDav(next: Partial<WebDavSettings>): Promise<void> {
    webdav.value = {
      ...webdav.value,
      ...next
    };
    if (isTauri) {
      const promises: Promise<void>[] = [];
      if (next.url !== undefined) {
        promises.push(setSetting('webdavUrl', next.url));
      }
      if (next.username !== undefined) {
        promises.push(setSetting('webdavUsername', next.username));
      }
      if (next.password !== undefined) {
        promises.push(setSetting('webdavPassword', next.password));
      }
      if (next.path !== undefined) {
        promises.push(setSetting('webdavPath', next.path));
      }
      if (next.autoSync !== undefined) {
        promises.push(setSetting('webdavAutoSync', String(next.autoSync)));
      }
      if (next.syncInterval !== undefined) {
        promises.push(setSetting('webdavSyncInterval', String(next.syncInterval)));
      }
      await Promise.all(promises).catch(console.error);
    }
  }

  async function updateAi(next: Partial<AiSettings>): Promise<void> {
    ai.value = {
      ...ai.value,
      ...next
    };
    if (isTauri) {
      const promises: Promise<void>[] = [];
      if (next.endpoint !== undefined) {
        promises.push(setSetting('aiEndpoint', next.endpoint));
      }
      if (next.apiKey !== undefined) {
        promises.push(setSetting('aiApiKey', next.apiKey));
      }
      if (next.model !== undefined) {
        promises.push(setSetting('aiModel', next.model));
      }
      await Promise.all(promises).catch(console.error);
    }
  }

  async function updateCloseToTray(value: boolean): Promise<void> {
    closeToTray.value = value;
    if (isTauri) {
      await setSetting('closeToTray', String(value)).catch(console.error);
    }
  }

  return {
    timer,
    pomodoro,
    notification,
    webdav,
    ai,
    closeToTray,
    loadFromData,
    updatePomodoro,
    updateNotification,
    updateWebDav,
    updateAi,
    updateCloseToTray
  };
});
