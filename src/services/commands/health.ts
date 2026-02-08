import { invokeCommand } from './invoke';

export async function getBackendHealth(): Promise<string> {
  return invokeCommand<string>('health_check');
}
