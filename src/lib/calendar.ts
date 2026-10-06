// Days in a calendar month, guarding February for leap years. Shared by the
// date parsers (format-date.ts, users.ts), which must reject impossible
// dates themselves: Date.parse and the Date constructor silently roll
// "2026-02-30" over to March instead of failing. Returns 0 for an
// out-of-range month so callers can treat it as an invalid date.
export function daysInMonth(year: number, month: number): number {
  return (
    [
      31,
      year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ][month - 1] ?? 0
  );
}
