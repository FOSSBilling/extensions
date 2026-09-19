import type { APIContext } from 'astro';

// Purging both tags together is a single CDN purge call, and every catalogue
// mutation touches at least one of the two surfaces.
const PURGE_TAGS = ['catalogue', 'developers'];

// Mutation endpoints call this fire-and-forget right after a successful
// write: the CDN purge runs on waitUntil so the redirect is not delayed, and
// route-cached catalogue pages re-render on the next request — dashboard
// changes become visible within a second or two instead of after a TTL.
export function purgeCatalogue(context: APIContext): void {
  if (!context.cache.enabled) return;

  const purge = context.cache
    .invalidate({ tags: [...PURGE_TAGS] })
    .catch(() => {});

  context.locals.cfContext?.waitUntil(purge);
}
