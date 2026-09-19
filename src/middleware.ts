import { defineMiddleware } from 'astro:middleware';
import { getApplicationEnv, getRequestTimeZone } from '@/platform/cloudflare';

// The site renders no third-party frames, so framing is refused outright.
// CSP frame-ancestors covers modern browsers; X-Frame-Options covers the
// remainder. Responses carry these headers into the CDN cache, so edge-cache
// hits replay them too.
function applySecurityHeaders(response: Response): void {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
}

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.env = getApplicationEnv();
  context.locals.timeZone = getRequestTimeZone(context.request);

  const response = await next();
  applySecurityHeaders(response);
  return response;
});
