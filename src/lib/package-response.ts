import type { APIContext } from 'astro';
import { getSessionUser } from '@/lib/session';
import { ApiRequestError, downloadPackage } from '@/lib/api/client';

export async function packageResponse(
  context: APIContext,
  resource: 'download' | 'icon' = 'download',
): Promise<Response> {
  const { packageId } = context.params;
  if (!packageId) return new Response(null, { status: 404 });
  const env = context.locals.env;
  try {
    const user = await getSessionUser(context.cookies, env.sessionSecret);
    const upstream = await downloadPackage(
      env,
      packageId,
      user?.sub,
      resource,
      resource === 'icon'
        ? (context.request.headers.get('Accept') ?? 'image/png')
        : undefined,
    );
    const headers = new Headers({
      'Cache-Control': 'private, no-store',
      'Cloudflare-CDN-Cache-Control': 'no-store',
      Vary: resource === 'icon' ? 'Cookie, Accept' : 'Cookie',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const name of [
      'Content-Type',
      'Content-Disposition',
      'ETag',
      'Content-Length',
      'Content-Security-Policy',
    ]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { headers });
  } catch (error) {
    if (!(error instanceof ApiRequestError))
      console.error('[package] Unable to read package', error);
    const status = error instanceof ApiRequestError ? error.status : 503;
    return new Response(
      status === 404
        ? 'Package not found.'
        : status === 401 || status === 403
          ? 'You do not have access to this package.'
          : status < 500 && status !== 429
            ? 'This package request could not be completed.'
            : 'This package is temporarily unavailable. Please try again.',
      {
        status,
        headers: {
          'Cache-Control': 'private, no-store',
          'Cloudflare-CDN-Cache-Control': 'no-store',
        },
      },
    );
  }
}
