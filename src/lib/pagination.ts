export function cursorPageUrl(
  current: URL,
  parameter: string,
  cursor: string,
): string {
  const next = new URL(current);
  next.searchParams.set(parameter, cursor);
  return next.pathname + next.search;
}
