import { defineMiddleware } from 'astro:middleware';
import { getApplicationEnv, getRequestTimeZone } from '@/platform/cloudflare';
import { cacheRenderedPage, matchCachedPage } from '@/lib/page-cache';

// The site renders no third-party frames, so framing is refused outright.
// CSP frame-ancestors covers modern browsers; X-Frame-Options covers the
// remainder. Applied before the page cache stores responses so cached HTML
// carries them too.
function applySecurityHeaders(response: Response): void {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
}

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.env = getApplicationEnv();
  context.locals.timeZone = getRequestTimeZone(context.request);

  // Public catalogue HTML carries no per-user markup (header chrome and the
  // flash toast are Server Islands), so complete pages can be served straight
  // from the edge cache. Island endpoint requests, account/auth pages, and
  // POSTs are excluded inside the cache helpers.
  const cachedPage = await matchCachedPage(context.request);
  if (cachedPage) {
    return cachedPage;
  }

  const response = await next();
  applySecurityHeaders(response);
  await cacheRenderedPage(context.request, response);
  return response;
});
