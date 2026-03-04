import { invokeCommand } from './invoke';
import type { NotificationLogItem } from '../../types/domain';

export function createNotification(
  type: string,
  title: string,
  body: string,
  payload?: string
): Promise<number> {
  return invokeCommand<number>('notification_create', { type, title, body, payload });
}

export function listNotifications(
  limit?: number,
  offset?: number,
  unreadOnly?: boolean
): Promise<NotificationLogItem[]> {
  return invokeCommand<NotificationLogItem[]>('notification_list', {
    limit,
    offset,
    unreadOnly,
  });
}

export function markNotificationRead(id: number): Promise<void> {
  return invokeCommand<void>('notification_mark_read', { id });
}

export function markAllNotificationsRead(): Promise<void> {
  return invokeCommand<void>('notification_mark_all_read');
}

export function getUnreadCount(): Promise<number> {
  return invokeCommand<number>('notification_unread_count');
}
