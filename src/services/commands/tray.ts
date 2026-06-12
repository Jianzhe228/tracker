import { invokeCommand } from './invoke';

/** Push timer state to the tray tooltip. Unsupported on some Linux backends. */
export function setTrayTooltip(tooltip: string): Promise<void> {
  return invokeCommand<void>('set_tray_tooltip', { tooltip });
}
