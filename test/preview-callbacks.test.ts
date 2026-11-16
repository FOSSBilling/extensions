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
  it('registers routable staging and live branch Previews and removes orphaned callbacks', async () => {
    let callbacks: unknown;
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.startsWith('https://api.github.com/')) {
        return Response.json([
          { name: 'feature/test' },
          { name: 'feature/unroutable' },
          { name: 'main' },
        ]);
      }
      if (
        new URL(url).pathname ===
        '/client/v4/accounts/account/workers/workers/extensions/previews'
      ) {
        return Response.json({
          result: [
            {
              name: 'staging',
              urls: ['https://staging-extensions.fossbilling.workers.dev'],
            },
            {
              name: 'feature/test',
              urls: ['https://feature-test-extensions.fossbilling.workers.dev'],
            },
            { name: 'feature/unroutable', urls: [] },
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
    expect(await syncPreviewCallbacks(options, fetcher)).toBe(2);
    expect(callbacks).toEqual([
      'https://feature-test-extensions.fossbilling.workers.dev/auth/callback',
      'https://staging-extensions.fossbilling.workers.dev/auth/callback',
    ]);
  });

  it.each(['api.github.com', 'api.cloudflare.com'])(
    'preserves callbacks when %s metadata cannot be read',
    async (failedHost) => {
      let registrationAttempted = false;
      const fetcher = (async (input: string | URL | Request) => {
        const host = new URL(String(input)).hostname;
        if (host === failedHost) return new Response(null, { status: 403 });
        if (host === 'api.github.com') return Response.json([]);
        registrationAttempted = true;
        return new Response(null, { status: 204 });
      }) as typeof fetch;
      await expect(syncPreviewCallbacks(options, fetcher)).rejects.toThrow(
        'HTTP 403',
      );
      expect(registrationAttempted).toBe(false);
    },
  );
});
