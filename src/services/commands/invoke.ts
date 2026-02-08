import { invoke } from '@tauri-apps/api/core';

export async function invokeCommand<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  if (!('__TAURI_INTERNALS__' in window)) {
    throw new Error('Tauri runtime is not available. Please run inside tauri:dev.');
  }

  return invoke<T>(command, payload);
}
