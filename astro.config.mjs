// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  // Canonical and Open Graph URLs are built from this origin at render time.
  site: 'https://extensions.fossbilling.org',
  // Route caching: public catalogue pages carry a Cloudflare-CDN-Cache-Control
  // header, so Cloudflare's zone-wide CDN serves cache hits without invoking
  // the worker at all. Per-colo Cache API cannot be purged remotely; these
  // entries are tag-purgeable, which is what makes catalogue mutations
  // visible within seconds instead of after a TTL (see lib/cache-invalidate).
  cache: {
    provider: cacheCloudflare(),
  },
  routeRules: {
    // New submissions enter a pending review queue, so the catalogue only
    // changes when a dashboard approval (purges 'catalogue') or an api-side
    // writer (POST /api/revalidate) publishes something; between events,
    // maxAge+SWR bound the staleness of any other drift.
    //
    // /developer/[id] is deliberately NOT cached: unclaimed profiles render
    // a session-dependent claim form vs sign-in link, and CDN hits are
    // served by URL without cookies, so the first visitor's variant would
    // leak to everyone.
    '/': { maxAge: 120, swr: 60, tags: ['catalogue'] },
    '/extension/[id]': { maxAge: 300, swr: 120, tags: ['catalogue'] },
    '/404': { maxAge: 60 },
  },
  // Hover-prefetch same-origin links so catalogue navigation feels instant;
  // catalogue and extension pages come from the CDN cache, while surfaces
  // that render per-hover (developer pages — uncached by design — and OAuth
  // links) opt out per-link via data-astro-prefetch="false".
  prefetch: { prefetchAll: true },
  // Image URLs are served through src/pages/images/[variant].ts. Keep Astro's
  // built-in asset image service as passthrough because pages render ordinary
  // <img> elements and the custom route owns the fixed image variants.
  adapter: cloudflare({ imageService: 'passthrough' }),
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ['basecoat-css/basecoat', 'basecoat-css/tabs'],
    },
  },
});
