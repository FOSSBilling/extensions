const DATE_FORMAT_OPTIONS = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
} as const;

const TIME_FORMAT_OPTIONS = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
} as const;

const RELATIVE_TIME_UNITS = [
  { unit: 'year', milliseconds: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', milliseconds: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'day', milliseconds: 24 * 60 * 60 * 1000 },
  { unit: 'hour', milliseconds: 60 * 60 * 1000 },
  { unit: 'minute', milliseconds: 60 * 1000 },
  { unit: 'second', milliseconds: 1000 },
] as const;

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', {
  numeric: 'always',
});

function toDate(value: string | Date): Date {
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
      const year = Number(dateOnly[1]);
      const month = Number(dateOnly[2]);
      const day = Number(dateOnly[3]);
      const daysInMonth = [
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
      ][month - 1];

      if (month < 1 || month > 12 || day < 1 || day > (daysInMonth ?? 0)) {
        throw new RangeError('Invalid time value');
      }
    }

    // Date-only ISO strings are parsed as UTC by the built-in Date
    // constructor, while the previous parser treats them as local dates.
    date = dateOnly ? new Date(`${value}T00:00:00`) : new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid time value');
  }

  return date;
}

function formatDatePart(date: Date, timeZone?: string): string {
  const options =
    timeZone === undefined
      ? DATE_FORMAT_OPTIONS
      : { ...DATE_FORMAT_OPTIONS, timeZone };

  return new Intl.DateTimeFormat('en-GB', options).format(date);
}

function formatTimePart(date: Date, timeZone?: string): string {
  const options =
    timeZone === undefined
      ? TIME_FORMAT_OPTIONS
      : { ...TIME_FORMAT_OPTIONS, timeZone };

  return new Intl.DateTimeFormat('en-GB', options).format(date);
}

// `d LLLL yyyy` (e.g. "30 July 2026") — locale-independent to read, unlike
// mm/dd/yyyy or dd/mm/yyyy which are ambiguous without knowing the reader's
// convention. Matches ReleasesTable's existing release date format.
export function formatDate(value: string | Date): string {
  return formatDatePart(toDate(value));
}

// Same as formatDate, plus a 24-hour time — only for cases where the exact
// moment matters (e.g. a link's expiry), not just the day.
export function formatDateTime(value: string | Date): string {
  const date = toDate(value);
  return `${formatDatePart(date)}, ${formatTimePart(date)}`;
}

// Letter abbreviations (BST, EDT, ...) are locale-dependent in ICU — e.g.
// Intl's "en-US" data has no mapping for UK zones and falls back to an
// offset for those, while "en-GB" does the same for US zones, and so on for
// every other region. There's no single locale that names every zone, so a
// fixed numeric offset (always "GMT+1"-style) is used instead — verbose but
// unambiguous and locale-independent.
function tzOffsetLabel(timeZone: string, date: Date): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName');
  // Intl's "en-US" data labels the offset "GMT" — swapped for "UTC", the
  // timezone-neutral standard these offsets are actually computed against
  // (and what avoids the earlier "GMT+1" vs. "is this UK time?" confusion).
  return (part?.value ?? timeZone).replace(/^GMT/, 'UTC');
}

// Same as formatDateTime, but rendered in `timeZone` (an IANA name, e.g. from
// Cloudflare's request.cf.timezone) with its offset appended, so a
// UTC-stored instant like a transfer link's expiry reads correctly against
// the viewer's own clock instead of the server's.
export function formatDateTimeInZone(
  value: string | Date,
  timeZone: string,
): string {
  const instant = toDate(value);
  return `${formatDatePart(instant, timeZone)}, ${formatTimePart(instant, timeZone)} (${tzOffsetLabel(timeZone, instant)})`;
}

export function formatRelativeTime(
  value: string | Date,
  now: Date = new Date(),
): string {
  const delta = toDate(value).getTime() - toDate(now).getTime();
  const absoluteDelta = Math.abs(delta);
  const unit =
    RELATIVE_TIME_UNITS.find(
      ({ milliseconds }) => absoluteDelta >= milliseconds,
    ) ?? RELATIVE_TIME_UNITS[RELATIVE_TIME_UNITS.length - 1];
  const amount = Math.trunc(delta / unit.milliseconds);

  return amount === 0 ? 'now' : relativeTimeFormatter.format(amount, unit.unit);
}
