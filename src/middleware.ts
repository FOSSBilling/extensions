import { defineMiddleware } from 'astro:middleware';
import { takeFlash } from '@/lib/flash';

// Reads (and clears) the flash here, in middleware, rather than in Base.astro
// or any page — by the time a nested layout component's frontmatter runs,
// Astro's streaming renderer may have already flushed response headers,
// which silently drops any session mutation made at that point (the delete
// never reaches the persisted write). Middleware runs before rendering
// starts, so the mutation is guaranteed to land before headers are sent.
export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.flash = await takeFlash(context.session);
  return next();
});
