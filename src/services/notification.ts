import {
  isPermissionGranted,
  requestPermission,
  sendNotification as tauriSendNotification,
} from '@tauri-apps/plugin-notification';
import { createNotification } from './commands/notification';

const isTauri = '__TAURI_INTERNALS__' in window;

// Cache permission status to avoid IPC on every notification
let permissionGranted: boolean | null = null;

export type NotificationType =
  | 'focusStart'
  | 'focusEnd'
  | 'breakEnd'
  | 'deadline'
  | 'pauseTimeout'
  | 'prediction';

export interface SendNotificationOptions {
  type: NotificationType;
  title: string;
  body: string;
  payload?: string;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (isTauri) {
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === 'granted';
    }
    permissionGranted = granted;
    return granted;
  }

  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') {
    permissionGranted = true;
    return true;
  }
  if (Notification.permission === 'denied') {
    permissionGranted = false;
    return false;
  }
  const result = await Notification.requestPermission();
  permissionGranted = result === 'granted';
  return permissionGranted;
}

export function sendNotification(options: SendNotificationOptions): void {
  const { type, title, body, payload } = options;

  // Send OS notification using cached permission
  if (isTauri) {
    if (permissionGranted === true) {
      tauriSendNotification({ title, body });
    } else if (permissionGranted === null) {
      // First call before ensureNotificationPermission — fallback to async check
      isPermissionGranted()
        .then((granted) => {
          permissionGranted = granted;
          if (granted) {
            tauriSendNotification({ title, body });
          }
        })
        .catch(console.error);
    }
  } else if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  } else {
    console.info('[notification]', title, body);
  }

  // Write to notification_logs
  if (isTauri) {
    createNotification(type, title, body, payload).catch(console.error);
  }
}
