const STACK_SEPARATOR = ',';
// Bounds how many prior cursors accumulate in the URL as someone pages
// forward. Older entries are dropped first (from the front) once this is
// exceeded; beyond this depth "Previous" can no longer reach all the way
// back to page 1, but that's a better trade-off than letting the URL grow
// without bound over a long paging session.
const MAX_STACK_DEPTH = 20;

// Builds the URL for the next page. `nextCursor` becomes the new cursor, and
// the current one (if any) is pushed onto `stackParam` so prevCursorPageUrl
// can pop it later. The stack is plain cursor values joined by commas —
// opaque cursors are base64 (see the API's db/cursor.ts), whose alphabet
// excludes ",", so a value can never be mistaken for the separator.
export function cursorPageUrl(
  current: URL,
  cursorParam: string,
  stackParam: string,
  nextCursor: string,
): string {
  const next = new URL(current);
  const currentCursor = current.searchParams.get(cursorParam);
  const stack = readStack(current, stackParam);
  if (currentCursor) stack.push(currentCursor);
  while (stack.length > MAX_STACK_DEPTH) stack.shift();

  next.searchParams.set(cursorParam, nextCursor);
  writeStack(next, stackParam, stack);
  return next.pathname + next.search;
}

// Builds the URL for the page before the current one by popping the
// back-stack, or null if already on the first page (nothing to go back to).
export function prevCursorPageUrl(
  current: URL,
  cursorParam: string,
  stackParam: string,
): string | null {
  if (!current.searchParams.get(cursorParam)) return null;

  const next = new URL(current);
  const stack = readStack(current, stackParam);
  const prevCursor = stack.pop();

  if (prevCursor) {
    next.searchParams.set(cursorParam, prevCursor);
  } else {
    next.searchParams.delete(cursorParam);
  }
  writeStack(next, stackParam, stack);
  return next.pathname + next.search;
}

// Switching a filter starts a fresh page, so any cursor state it was paired
// with is dropped along with it — otherwise the new filter would seek (or
// step back) from a position that belonged to the old one.
export function filterPageUrl(
  current: URL,
  parameter: string,
  value: string | null,
  resetParameters: string[],
): string {
  const next = new URL(current);
  if (value === null) {
    next.searchParams.delete(parameter);
  } else {
    next.searchParams.set(parameter, value);
  }
  for (const resetParameter of resetParameters) {
    next.searchParams.delete(resetParameter);
  }
  return next.pathname + next.search;
}

function readStack(url: URL, stackParam: string): string[] {
  return (url.searchParams.get(stackParam) ?? '')
    .split(STACK_SEPARATOR)
    .filter(Boolean);
}

function writeStack(url: URL, stackParam: string, stack: string[]): void {
  if (stack.length > 0) {
    url.searchParams.set(stackParam, stack.join(STACK_SEPARATOR));
  } else {
    url.searchParams.delete(stackParam);
  }
}
