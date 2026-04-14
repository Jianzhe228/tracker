import { invokeCommand } from './invoke';

export async function getBackendHealth(): Promise<string> {
  return invokeCommand<string>('health_check');
}

export async function getAppVersion(): Promise<string> {
  return invokeCommand<string>('app_version');
}

export async function isDebugBuild(): Promise<boolean> {
  return invokeCommand<boolean>('is_debug_build');
}
