import { format, parseISO } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { TZDate } from '@date-fns/tz';

// `d LLLL yyyy` (e.g. "30 July 2026") — locale-independent to read, unlike
// mm/dd/yyyy or dd/mm/yyyy which are ambiguous without knowing the reader's
// convention. Matches ReleasesTable's existing release date format.
export function formatDate(value: string | Date): string {
  return format(
    typeof value === 'string' ? parseISO(value) : value,
    'd LLLL yyyy',
    {
      locale: enUS,
    },
  );
}

// Same as formatDate, plus a 24-hour time — only for cases where the exact
// moment matters (e.g. a link's expiry), not just the day.
export function formatDateTime(value: string | Date): string {
  return format(
    typeof value === 'string' ? parseISO(value) : value,
    'd LLLL yyyy, HH:mm',
    { locale: enUS },
  );
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
  const instant = typeof value === 'string' ? parseISO(value) : value;
  const zoned = TZDate.tz(timeZone, instant);
  return `${format(zoned, 'd LLLL yyyy, HH:mm', { locale: enUS })} (${tzOffsetLabel(timeZone, zoned)})`;
}
