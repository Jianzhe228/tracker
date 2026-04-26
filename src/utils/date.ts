/** Format total minutes as "X小时Y分钟" or "Y分钟" if less than 1 hour. */
export function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h > 0) return `${h}小时${m > 0 ? m + '分钟' : ''}`;
  return `${m}分钟`;
}

/** Format minutes for chart axis labels: use hours if >= 60m, otherwise minutes. */
export function formatAxisMinutes(minutes: number): string {
  if (minutes >= 60) return `${(minutes / 60).toFixed(1)}h`;
  return `${minutes}m`;
}

/** Format a Date as YYYY-MM-DD (local timezone). */
export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Get YYYY-MM-DD for today +/- offset days. */
export function getDateKeyFromToday(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return toDateKey(date);
}

/** Check if a date string falls within the next 7 days (today..today+6). */
export function isDateInRecent7Days(value: string | null): boolean {
  if (!value) return false;
  const today = getDateKeyFromToday(0);
  const day7 = getDateKeyFromToday(6);
  return value >= today && value <= day7;
}

/** Today's date key shorthand. */
export function todayDateKey(): string {
  return toDateKey(new Date());
}
