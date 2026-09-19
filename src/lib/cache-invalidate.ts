import type { APIContext } from 'astro';
import { markEdgeCachePurged } from './cache';

// Shared cache-tag vocabulary. astro.config.mjs's routeRules tag cached
// pages with these, and both purge paths — the dashboard helpers below and
// POST /api/revalidate — purge them. 'developers' currently tags no route
// (developer pages are deliberately uncached — see routeRules) but is kept
// accepted because the api worker sends it; purging a tag no URL carries is
// a no-op, and it is reserved for any future developer-surface caching.
export const CATALOGUE_CACHE_TAGS = ['catalogue', 'developers'];

// Purging both tags together is a single CDN purge call, and every catalogue
// mutation touches at least one of the two surfaces.
//
// Mutation endpoints call this fire-and-forget right after a successful
// write: the CDN purge runs on waitUntil so the redirect is not delayed, and
// route-cached catalogue pages re-render on the next request — dashboard
// changes become visible within a second or two instead of after a TTL.
export function purgeCatalogue(context: APIContext): void {
  if (!context.cache.enabled) return;

  let purge: Promise<void>;
  try {
    // Same-isolate data-cache entries must not repopulate re-renders with
    // pre-purge data (CDN tag purges cannot reach the per-colo Cache API).
    markEdgeCachePurged();
    purge = context.cache.invalidate({ tags: [...CATALOGUE_CACHE_TAGS] });
  } catch (error) {
    // A synchronous failure here must never fail the mutation that already
    // succeeded; the route-rule windows bound any staleness.
    console.error('[cache] CDN purge could not start:', error);
    return;
  }

  purge.catch((error) => {
    console.error('[cache] CDN purge failed:', error);
  });
  context.locals.cfContext?.waitUntil(purge);
}
