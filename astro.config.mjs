// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  // Canonical and Open Graph URLs are built from this origin at render time.
  site: 'https://extensions.fossbilling.org',
  // Hover-prefetch same-origin links so catalogue navigation feels instant;
  // prefetched pages are cheap because public pages are edge-cached.
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
