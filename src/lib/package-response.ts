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
    return new Response(
      error instanceof ApiRequestError && error.status === 404
        ? 'Package not found.'
        : 'This package is temporarily unavailable. Please try again.',
      {
        status: error instanceof ApiRequestError ? error.status : 503,
        headers: {
          'Cache-Control': 'private, no-store',
          'Cloudflare-CDN-Cache-Control': 'no-store',
        },
      },
    );
  }
}
