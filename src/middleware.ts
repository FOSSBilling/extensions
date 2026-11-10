import { defineMiddleware } from 'astro:middleware';
import { getApplicationEnv, getRequestTimeZone } from '@/platform/cloudflare';

// The site renders no third-party frames, so framing is refused outright.
// CSP frame-ancestors covers modern browsers; X-Frame-Options covers the
// remainder. Responses carry these headers into the CDN cache, so edge-cache
// hits replay them too. Returns the response to serve: some responses
// (Response.redirect) have immutable headers, so those are re-wrapped with
// the original status, headers, and streaming body before mutating.
function applySecurityHeaders(response: Response): Response {
  const apply = (target: Response) => {
    target.headers.set('X-Content-Type-Options', 'nosniff');
    target.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    target.headers.set('X-Frame-Options', 'DENY');
    // Keep resource-specific restrictions, including the package icon sandbox.
    target.headers.append('Content-Security-Policy', "frame-ancestors 'none'");
  };
  try {
    apply(response);
    return response;
  } catch {
    const unwrapped = new Response(response.body, response);
    apply(unwrapped);
    return unwrapped;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.env = getApplicationEnv();
  context.locals.timeZone = getRequestTimeZone(context.request);

  const response = await next();
  const secured = applySecurityHeaders(response);
  // Apply after rewrites too: a cached anonymous 404 must not mask the same
  // unpublished extension for its owner on their next request.
  if (context.url.pathname.startsWith('/extension/')) {
    secured.headers.set('Cache-Control', 'private, no-store');
    secured.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  }
  return secured;
});
