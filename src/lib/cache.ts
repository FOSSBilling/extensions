// Edge-cache helpers for public, user-independent responses. Cloudflare
// does not automatically cache Worker-generated responses, so hot public
// reads are stored through the Cache API (per-colo, isolate-independent)
// with a short TTL: catalogue content only changes when a moderator
// approves a revision, so a minute of staleness trades negligible
// invocation and API-subrequest cost for most repeat traffic.

const CATALOGUE_CACHE_TTL_SECONDS = 60;

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
      return (await hit.json()) as T;
    }
  } catch {
    // A malformed or unreadable cache entry is treated as a miss.
  }

  const value = await producer();

  try {
    await cache.put(
      key,
      new Response(JSON.stringify(value), {
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
