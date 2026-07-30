// URL fields are edited as a fixed "https://" prefix (input-group span) plus
// a plain-text domain/path input, rather than a full-URL input — these two
// functions keep the input's display value and the stored full URL in sync.
// Any scheme the user pastes in is stripped rather than doubled, and
// http:// is always upgraded to https:// on save.
const SCHEME_RE = /^https?:\/\//i;

export function stripUrlScheme(url: string | undefined | null): string {
  return url ? url.replace(SCHEME_RE, '') : '';
}

export function withHttpsScheme(value: string): string | undefined {
  const stripped = value.trim().replace(SCHEME_RE, '');
  return stripped ? `https://${stripped}` : undefined;
}
