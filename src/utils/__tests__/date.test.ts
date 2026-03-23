/**
 * Tests for date utility functions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toDateKey, getDateKeyFromToday, isDateInRecent7Days, todayDateKey } from '../date';

describe('toDateKey', () => {
  it('formats a normal date correctly', () => {
    const date = new Date(2026, 2, 23); // March 23, 2026
    expect(toDateKey(date)).toBe('2026-03-23');
  });

  it('pads single-digit month and day with leading zeros', () => {
    const date = new Date(2026, 0, 5); // January 5, 2026
    expect(toDateKey(date)).toBe('2026-01-05');
  });

  it('handles December 31 (last day of year)', () => {
    const date = new Date(2025, 11, 31);
    expect(toDateKey(date)).toBe('2025-12-31');
  });

  it('handles January 1 (first day of year)', () => {
    const date = new Date(2026, 0, 1);
    expect(toDateKey(date)).toBe('2026-01-01');
  });

  it('handles double-digit months and days without extra padding', () => {
    const date = new Date(2026, 10, 15); // November 15
    expect(toDateKey(date)).toBe('2026-11-15');
  });

  it('handles leap day', () => {
    const date = new Date(2024, 1, 29); // Feb 29, 2024 (leap year)
    expect(toDateKey(date)).toBe('2024-02-29');
  });

  it('handles year with fewer than 4 digits (no zero-padding on year)', () => {
    const date = new Date(999, 5, 10);
    date.setFullYear(999); // constructor treats 2-digit years as 1900+
    expect(toDateKey(date)).toBe('999-06-10');
  });
});

describe('getDateKeyFromToday', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 23, 12, 0, 0)); // March 23, 2026 noon
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns today when offset is 0', () => {
    expect(getDateKeyFromToday(0)).toBe('2026-03-23');
  });

  it('returns tomorrow when offset is 1', () => {
    expect(getDateKeyFromToday(1)).toBe('2026-03-24');
  });

  it('returns yesterday when offset is -1', () => {
    expect(getDateKeyFromToday(-1)).toBe('2026-03-22');
  });

  it('handles positive offset crossing month boundary', () => {
    expect(getDateKeyFromToday(9)).toBe('2026-04-01');
  });

  it('handles negative offset crossing month boundary', () => {
    vi.setSystemTime(new Date(2026, 2, 1, 12, 0, 0)); // March 1
    expect(getDateKeyFromToday(-1)).toBe('2026-02-28');
  });

  it('handles large positive offset', () => {
    expect(getDateKeyFromToday(365)).toBe('2027-03-23');
  });

  it('handles large negative offset', () => {
    expect(getDateKeyFromToday(-365)).toBe('2025-03-23');
  });

  it('handles offset crossing year boundary', () => {
    vi.setSystemTime(new Date(2026, 11, 30, 12, 0, 0)); // Dec 30, 2026
    expect(getDateKeyFromToday(3)).toBe('2027-01-02');
  });
});

describe('isDateInRecent7Days', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 23, 12, 0, 0)); // March 23, 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for today', () => {
    expect(isDateInRecent7Days('2026-03-23')).toBe(true);
  });

  it('returns true for tomorrow', () => {
    expect(isDateInRecent7Days('2026-03-24')).toBe(true);
  });

  it('returns true for day at end of 7-day window (today+6)', () => {
    expect(isDateInRecent7Days('2026-03-29')).toBe(true);
  });

  it('returns false for day after 7-day window (today+7)', () => {
    expect(isDateInRecent7Days('2026-03-30')).toBe(false);
  });

  it('returns false for yesterday', () => {
    expect(isDateInRecent7Days('2026-03-22')).toBe(false);
  });

  it('returns false for a date far in the past', () => {
    expect(isDateInRecent7Days('2020-01-01')).toBe(false);
  });

  it('returns false for a date far in the future', () => {
    expect(isDateInRecent7Days('2030-12-31')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isDateInRecent7Days(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isDateInRecent7Days('')).toBe(false);
  });

  it('handles window crossing month boundary', () => {
    vi.setSystemTime(new Date(2026, 2, 28, 12, 0, 0)); // March 28
    // Window: March 28 - April 3
    expect(isDateInRecent7Days('2026-03-28')).toBe(true);
    expect(isDateInRecent7Days('2026-04-01')).toBe(true);
    expect(isDateInRecent7Days('2026-04-03')).toBe(true);
    expect(isDateInRecent7Days('2026-04-04')).toBe(false);
  });

  it('handles window crossing year boundary', () => {
    vi.setSystemTime(new Date(2026, 11, 28, 12, 0, 0)); // Dec 28, 2026
    // Window: Dec 28 - Jan 3
    expect(isDateInRecent7Days('2026-12-28')).toBe(true);
    expect(isDateInRecent7Days('2026-12-31')).toBe(true);
    expect(isDateInRecent7Days('2027-01-01')).toBe(true);
    expect(isDateInRecent7Days('2027-01-03')).toBe(true);
    expect(isDateInRecent7Days('2027-01-04')).toBe(false);
  });
});

describe('todayDateKey', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns today formatted as YYYY-MM-DD', () => {
    vi.setSystemTime(new Date(2026, 2, 23, 15, 30, 0));
    expect(todayDateKey()).toBe('2026-03-23');
  });

  it('returns correct key at midnight', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
    expect(todayDateKey()).toBe('2026-01-01');
  });

  it('returns correct key at end of day', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 23, 59, 59));
    expect(todayDateKey()).toBe('2026-01-01');
  });

  it('matches getDateKeyFromToday(0)', () => {
    vi.setSystemTime(new Date(2026, 5, 15, 10, 0, 0));
    expect(todayDateKey()).toBe(getDateKeyFromToday(0));
  });
});
