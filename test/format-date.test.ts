import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDateTimeInZone,
  formatRelativeTime,
} from '@/lib/format-date';

describe('date formatting', () => {
  it('formats dates and local date-times using the application format', () => {
    const localDate = new Date(2026, 6, 30, 13, 5);

    expect(formatDate(localDate)).toBe('30 July 2026');
    expect(formatDateTime(localDate)).toBe('30 July 2026, 13:05');
  });

  it('formats an instant in an explicit time zone with its numeric offset', () => {
    expect(formatDateTimeInZone('2026-07-30T13:05:00Z', 'Europe/London')).toBe(
      '30 July 2026, 14:05 (UTC+1)',
    );
  });

  it('keeps date-only ISO values on the local calendar date', () => {
    expect(formatDate('2026-07-30')).toBe('30 July 2026');
  });

  it('formats relative release times without a date library', () => {
    const now = new Date('2026-07-30T13:05:00Z');

    expect(formatRelativeTime('2026-07-30T11:05:00Z', now)).toBe('2 hours ago');
    expect(formatRelativeTime('2026-07-30T13:05:00Z', now)).toBe('now');
  });

  it('rejects invalid dates', () => {
    expect(() => formatDate('not-a-date')).toThrow(RangeError);
  });
});
