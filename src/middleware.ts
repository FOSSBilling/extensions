import { defineMiddleware } from 'astro:middleware';
import { getApplicationEnv, getRequestTimeZone } from '@/platform/cloudflare';
import { cacheRenderedPage, matchCachedPage } from '@/lib/page-cache';

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
  await cacheRenderedPage(context.request, response);
  return response;
});
