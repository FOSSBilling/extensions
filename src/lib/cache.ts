// Edge-cache helpers for public, user-independent responses. Cloudflare
// does not automatically cache Worker-generated responses, so hot public
// reads are stored through the Cache API (per-colo, isolate-independent)
// with a short TTL: catalogue content only changes when a moderator
// approves a revision, so a minute of staleness trades negligible
// invocation and API-subrequest cost for most repeat traffic.

const CATALOGUE_CACHE_TTL_SECONDS = 60;

// Per-isolate purge marker. CDN tag purges cannot reach the per-colo Cache
// API entries cached here, so a page re-rendered right after a purge could
// otherwise repopulate from a pre-purge data-cache entry. Purge paths call
// markEdgeCachePurged() and cachedEdgeRead() skips entries written before
// the marker — in the same isolate (the common dashboard POST -> redirect ->
// re-render flow) re-renders are always fresh; other isolates converge
// within the TTL.
let lastPurgeAtEpochMs = 0;

export function markEdgeCachePurged(): void {
  lastPurgeAtEpochMs = Date.now();
}

// Cache keys must be absolute URLs. The production origin keeps the key on
// the deployed zone; reads fall back to the producer if the cache is
// unavailable (plain Node, `astro dev`, or a preview host).
const CACHE_KEY_ORIGIN = 'https://extensions.fossbilling.org';

type EdgeCacheHolder = { caches?: { default?: Cache } };

function edgeCache(): Cache | undefined {
  return (globalThis as EdgeCacheHolder).caches?.default;
}

function encodedSortedParams(
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(name, String(value));
    }
  }
  search.sort();
  return search.toString();
}

export function dataCacheKey(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Request {
  const search = encodedSortedParams(params);
  return new Request(
    `${CACHE_KEY_ORIGIN}/_edge-cache/${path}${search ? `?${search}` : ''}`,
    {
      method: 'GET',
    },
  );
}

// Caches a JSON-serializable producer result under a normalized key.
// Failures are transparent in both directions: an unavailable or erroring
// cache simply falls through to the producer, and only successful producer
// results are stored — API errors and 404s are never cached.
export async function cachedEdgeRead<T>(
  key: Request,
  producer: () => Promise<T>,
): Promise<T> {
  const cache = edgeCache();
  if (!cache) {
    return producer();
  }

  try {
    const hit = await cache.match(key);
    if (hit) {
      const parsed: unknown = await hit.json();
      if (
        parsed &&
        typeof parsed === 'object' &&
        'writtenAt' in parsed &&
        typeof (parsed as { writtenAt?: unknown }).writtenAt === 'number'
      ) {
        const { writtenAt, value } = parsed as {
          writtenAt: number;
          value: T;
        };
        if (writtenAt <= lastPurgeAtEpochMs) {
          // Written before (or racing with) the most recent purge: treat as
          // a miss so the re-render repopulates from the producer with
          // post-purge data. Erring toward freshness here only costs an
          // extra producer call in a same-millisecond race.
        } else {
          return value;
        }
      } else {
        // Entry from before the writtenAt format existed: no age is known,
        // so serve it — its remaining TTL bounds any staleness.
        return parsed as T;
      }
    }
  } catch {
    // A malformed or unreadable cache entry is treated as a miss.
  }

  // Timestamp the miss, not the write: a producer that starts before a
  // purge and resolves after it would otherwise store pre-purge data stamped
  // as fresh (Date.now() at write time). The read-start time is always older
  // than any purge that lands mid-flight, so the entry is aged out instead.
  const missStartedAt = Date.now();
  const value = await producer();

  try {
    await cache.put(
      key,
      new Response(JSON.stringify({ writtenAt: missStartedAt, value }), {
        headers: {
          'content-type': 'application/json',
          'cache-control': `public, s-maxage=${CATALOGUE_CACHE_TTL_SECONDS}`,
        },
      }),
    );
  } catch {
    // Best-effort: serving the fresh value matters more than caching it.
  }

  return value;
}
