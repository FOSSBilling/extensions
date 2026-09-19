// Full-page edge cache for public catalogue HTML. Pages under the
// allowlisted paths render no per-user markup — the signed-in header chrome
// and the flash toast are Server Islands (src/components/HeaderAccount.astro,
// src/components/FlashToaster.astro) — so their HTML is identical for every
// visitor and safe to serve from the per-colo Cache API for a short TTL.
// Anything personalized, mutable, or form-driven stays out of the cache.

const PAGE_CACHE_TTL_SECONDS = 60;
const CACHEABLE_PATHS = new Set(['/']);
const CACHEABLE_PATH_PREFIXES = ['/extension/', '/developer/'];

type EdgeCacheHolder = { caches?: { default?: Cache } };

function edgeCache(): Cache | undefined {
  return (globalThis as EdgeCacheHolder).caches?.default;
}

function isCacheablePath(pathname: string): boolean {
  return (
    CACHEABLE_PATHS.has(pathname) ||
    CACHEABLE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

function pageCacheKey(request: Request): Request {
  return new Request(request.url, { method: 'GET' });
}

export async function matchCachedPage(
  request: Request,
): Promise<Response | undefined> {
  if (
    request.method !== 'GET' ||
    !isCacheablePath(new URL(request.url).pathname)
  ) {
    return undefined;
  }

  const cache = edgeCache();
  if (!cache) {
    return undefined;
  }

  try {
    return (await cache.match(pageCacheKey(request))) ?? undefined;
  } catch {
    return undefined;
  }
}

// Stores a rendered page for later cache hits. Only complete, anonymous
// HTML responses qualify: 2xx status, HTML content type, and no Set-Cookie
// header (a cookie would leak one visitor's state into another's visit).
export async function cacheRenderedPage(
  request: Request,
  response: Response,
): Promise<void> {
  if (
    request.method !== 'GET' ||
    !isCacheablePath(new URL(request.url).pathname)
  ) {
    return;
  }
  if (response.status !== 200) {
    return;
  }
  const contentType = response.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('text/html')) {
    return;
  }
  if (response.headers.has('set-cookie')) {
    return;
  }

  const cache = edgeCache();
  if (!cache) {
    return;
  }

  const headers = new Headers(response.headers);
  headers.set('cache-control', `public, s-maxage=${PAGE_CACHE_TTL_SECONDS}`);

  try {
    await cache.put(
      pageCacheKey(request),
      new Response(response.clone().body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
    );
  } catch {
    // Best-effort: the rendered response is still returned to the client.
  }
}
