// Developer-supplied URLs (Developer.URL, DeveloperHistoryEntry.URL) are
// rendered as <a href>. A javascript:/data: URI there would execute in the
// viewer's session when clicked — including a moderator's, on the history
// and moderation pages. Only http(s) URLs are safe to render as a link;
// anything else should be shown as plain text instead.
export function isSafeHttpUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
