export function notify(message: string): void {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Tracker', { body: message });
    return;
  }

  console.info('[notification]', message);
}
