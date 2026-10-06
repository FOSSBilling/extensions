import { vi } from 'vitest';

// In-memory stand-in for the Cache API's caches.default, stubbed onto
// globalThis. `keyOf` derives the cache key from the request: the data cache
// keys on the URL alone, while the image cache also varies on the request's
// Accept header.
export function stubEdgeCache(
  keyOf: (request: Request) => string = (request) => request.url,
) {
  const entries = new Map<string, { body: string; headers: Headers }>();
  const cache = {
    entries,
    match: vi.fn(async (key: Request) => {
      const entry = entries.get(keyOf(key));
      return entry
        ? new Response(entry.body, { headers: entry.headers })
        : undefined;
    }),
    put: vi.fn(async (key: Request, response: Response) => {
      entries.set(keyOf(key), {
        body: await response.clone().text(),
        headers: response.headers,
      });
    }),
  };
  vi.stubGlobal('caches', { default: cache });
  return cache;
}
