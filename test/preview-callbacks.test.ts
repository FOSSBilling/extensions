import { describe, expect, it } from 'vitest';
import { syncPreviewCallbacks } from '../scripts/sync-preview-callbacks';

const options = {
  githubToken: 'github-token',
  cloudflareToken: 'read-only-cloudflare-token',
  cloudflareAccount: 'account',
  oidcRequestUrl: 'https://oidc.example.test/token?request=1',
  oidcRequestToken: 'oidc-request-token',
};

describe('Preview callback reconciliation', () => {
  it('registers live branch Preview URLs and removes orphaned callbacks', async () => {
    let callbacks: unknown;
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.startsWith('https://api.github.com/')) {
        return Response.json([{ name: 'feature/test' }, { name: 'main' }]);
      }
      if (url.endsWith('/workers/services/extensions')) {
        return Response.json({
          result: { default_environment: { script: { tag: 'worker' } } },
        });
      }
      if (url.includes('/previews?')) {
        return Response.json({
          result: [
            {
              name: 'feature/test',
              urls: ['https://feature-test-extensions.fossbilling.workers.dev'],
            },
            {
              name: 'deleted-branch',
              urls: [
                'https://deleted-branch-extensions.fossbilling.workers.dev',
              ],
            },
          ],
        });
      }
      if (url.startsWith('https://oidc.example.test/')) {
        expect(new URL(url).searchParams.get('audience')).toBe(
          'https://auth.fossbilling.net/integrations/extensions-preview-callbacks',
        );
        return Response.json({ value: 'short-lived-oidc-token' });
      }
      expect(url).toBe(
        'https://auth.fossbilling.net/integrations/extensions-preview-callbacks',
      );
      expect(init?.method).toBe('PUT');
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer short-lived-oidc-token',
      );
      callbacks = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    expect(await syncPreviewCallbacks(options, fetcher)).toBe(1);
    expect(callbacks).toEqual([
      'https://feature-test-extensions.fossbilling.workers.dev/auth/callback',
    ]);
  });

  it('does not clear callbacks when metadata cannot be read', async () => {
    const calls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(null, { status: 403 });
    }) as typeof fetch;
    await expect(syncPreviewCallbacks(options, fetcher)).rejects.toThrow(
      'HTTP 403',
    );
    expect(calls).toHaveLength(1);
  });
});
