import type { APIContext } from 'astro';
import { describe, expect, it, vi } from 'vitest';
vi.mock('astro:middleware', () => ({
  defineMiddleware: (handler: unknown) => handler,
}));
vi.mock('@/platform/cloudflare', () => ({
  getApplicationEnv: () => ({}),
  getRequestTimeZone: () => 'UTC',
}));
import { onRequest } from '@/middleware';
function context(path: string) {
  return {
    url: new URL(path, 'https://extensions.example.test'),
    request: new Request('https://extensions.example.test' + path),
    locals: {},
  } as APIContext;
}
describe('personalized extension HTML caching', () => {
  it.each([200, 404, 503])(
    'prevents shared and browser caching, including rewritten/error responses (%s)',
    async (status) => {
      const response = await onRequest(
        context('/extension/example'),
        async () =>
          new Response('content', {
            status,
            headers: {
              'Cloudflare-CDN-Cache-Control': 'public, max-age=60',
              'Cache-Control': 'public, max-age=60',
            },
          }),
      );
      if (!response) throw new Error('Expected a response');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
        'no-store',
      );
      expect(response.status).toBe(status);
    },
  );
  it('also protects immutable redirect responses', async () => {
    const response = await onRequest(
      context('/extension/example/withdraw'),
      async () => Response.redirect('https://extensions.example.test/account'),
    );
    if (!response) throw new Error('Expected a response');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
      'no-store',
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://extensions.example.test/account',
    );
  });
  it('preserves extension directory page caching', async () => {
    const response = await onRequest(
      context('/'),
      async () =>
        new Response('extensions', {
          headers: { 'Cloudflare-CDN-Cache-Control': 'public, max-age=120' },
        }),
    );
    if (!response) throw new Error('Expected a response');
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
      'public, max-age=120',
    );
  });
});
