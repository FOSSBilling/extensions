import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApplicationEnv } from '@/platform/cloudflare';

vi.mock('cloudflare:workers', () => ({
  env: {
    EXTENSIONS_API_TRANSPORT: 'http',
    EXTENSIONS_API_BASE_URL: 'https://staging-api.example.test',
  },
}));

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare HTTP transport', () => {
  it('calls native fetch with its global receiver', async () => {
    const request = new Request(
      'https://staging-api.example.test/extensions/v2',
    );
    const response = new Response('{}');
    vi.stubGlobal('fetch', function (this: unknown, input: RequestInfo | URL) {
      expect(this).toBe(globalThis);
      expect(input).toBe(request);
      return Promise.resolve(response);
    });

    const env = getApplicationEnv();
    await expect(env.extensionsApi.fetch(request)).resolves.toBe(response);
  });
});
