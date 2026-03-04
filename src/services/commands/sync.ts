import { invokeCommand } from './invoke';

import type { SyncStatusResult } from '../../types/domain';

export function testWebDavConnection(
  url: string,
  username: string,
  password: string,
  path: string,
): Promise<string> {
  return invokeCommand<string>('webdav_test_connection', { url, username, password, path });
}

export function webdavUpload(
  url: string,
  username: string,
  password: string,
  path: string,
): Promise<string> {
  return invokeCommand<string>('webdav_upload', { url, username, password, path });
}

export function webdavDownload(
  url: string,
  username: string,
  password: string,
  path: string,
): Promise<string> {
  return invokeCommand<string>('webdav_download', { url, username, password, path });
}

export function webdavSyncStatus(): Promise<SyncStatusResult> {
  return invokeCommand<SyncStatusResult>('webdav_sync_status');
}
