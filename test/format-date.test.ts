import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDateTimeInZone,
  formatRelativeTime,
  formatShortDate,
} from '@/lib/format-date';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('date formatting', () => {
  it('formats dates and local date-times using the application format', () => {
    // Production callers pass strings; the single Date input here guards
    // toDate's Date passthrough branch.
    expect(formatDate(new Date(2026, 6, 30, 13, 5))).toBe('30 July 2026');
    expect(formatDateTime('2026-07-30T13:05:00')).toBe('30 July 2026, 13:05');
  });

  it('formats compact day-first dates with an abbreviated month', () => {
    expect(formatShortDate('2026-09-17')).toBe('17 Sept 2026');
    expect(formatShortDate('2026-07-30')).toBe('30 Jul 2026');
  });

  it('formats an instant in an explicit time zone with its numeric offset', () => {
    expect(formatDateTimeInZone('2026-07-30T13:05:00Z', 'Europe/London')).toBe(
      '30 July 2026, 14:05 (UTC+1)',
    );
  });

  it('keeps date-only ISO values on the local calendar date', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    expect(formatDate('2026-07-30')).toBe('30 July 2026');
  });

  it('formats relative release times without a date library', () => {
    const now = new Date('2026-07-30T13:05:00Z');

    expect(formatRelativeTime('2026-07-30T11:05:00Z', now)).toBe('2 hours ago');
    expect(formatRelativeTime('2026-07-30T13:05:00Z', now)).toBe('now');
  });

  it('handles the date-only strings real callers pass to relative formatting', () => {
    // ReleasesCard passes release.date (date-only), which parses as local
    // midnight — with UTC that is 13:05 of difference on the same day.
    vi.stubEnv('TZ', 'UTC');
    const now = new Date('2026-07-30T13:05:00Z');
    expect(formatRelativeTime('2026-07-30', now)).toBe('13 hours ago');
  });

  it('does not round relative values across their unit boundary', () => {
    const now = new Date('2026-07-30T13:05:00Z');

    expect(formatRelativeTime('2026-07-30T14:04:29Z', now)).toBe(
      'in 59 minutes',
    );
    expect(formatRelativeTime('2026-07-30T14:04:30Z', now)).toBe('in 1 hour');
    expect(formatRelativeTime('2026-07-30T11:35:00Z', now)).toBe('2 hours ago');
    expect(formatRelativeTime('2026-07-31T13:05:00Z', now)).toBe('in 1 day');
  });

  it('rejects invalid dates', () => {
    expect(() => formatDate('not-a-date')).toThrow(RangeError);
    // '2026-02-31' must throw at the calendar guard: the Date constructor
    // would silently roll it forward to March.
    expect(() => formatDate('2026-02-31')).toThrow(RangeError);
    expect(() => formatDate('2026-02-31T00:00:00Z')).toThrow(RangeError);
  });
});
