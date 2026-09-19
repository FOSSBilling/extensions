import { describe, expect, it, vi } from 'vitest';
import { POST } from '@/pages/api/revalidate';
import type { ApplicationEnv } from '@/lib/runtime';

const SECRET = 'test-revalidate-secret';

function makeEnv(overrides: Partial<ApplicationEnv> = {}): ApplicationEnv {
  return {
    extensionsApi: {
      baseUrl: 'https://api.example.test',
      fetch: globalThis.fetch,
    },
    authClientId: 'id',
    authClientSecret: 'secret',
    sessionSecret: 'session-secret',
    assertionSigningSecret: 'assertion-secret',
    revalidateSecret: SECRET,
    ...overrides,
  };
}

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://extensions.example.test/api/revalidate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function makeCache() {
  return {
    enabled: true,
    invalidate: vi.fn(async () => {}),
  };
}

function makeContext(
  request: Request,
  env: ApplicationEnv,
  cache: ReturnType<typeof makeCache>,
) {
  return {
    request,
    locals: { env },
    cache,
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/revalidate', () => {
  it('rejects requests without a bearer token', async () => {
    const cache = makeCache();
    const response = await POST(
      makeContext(makeRequest({ tags: ['catalogue'] }), makeEnv(), cache),
    );

    expect(response.status).toBe(401);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('rejects a wrong token without leaking via timing-friendly compare', async () => {
    const cache = makeCache();
    const response = await POST(
      makeContext(
        makeRequest(
          { tags: ['catalogue'] },
          { authorization: `Bearer wrong-token` },
        ),
        makeEnv(),
        cache,
      ),
    );

    expect(response.status).toBe(401);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('rejects when no revalidate secret is configured', async () => {
    const cache = makeCache();
    const response = await POST(
      makeContext(
        makeRequest(
          { tags: ['catalogue'] },
          { authorization: `Bearer ${SECRET}` },
        ),
        makeEnv({ revalidateSecret: '' }),
        cache,
      ),
    );

    expect(response.status).toBe(401);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies', async () => {
    const cache = makeCache();
    const response = await POST(
      makeContext(
        makeRequest('not-json', { authorization: `Bearer ${SECRET}` }),
        makeEnv(),
        cache,
      ),
    );

    expect(response.status).toBe(400);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('rejects unknown or non-string tags', async () => {
    const cache = makeCache();
    for (const tags of [['products'], [], ['catalogue', 42], 'catalogue']) {
      const response = await POST(
        makeContext(
          makeRequest({ tags }, { authorization: `Bearer ${SECRET}` }),
          makeEnv(),
          cache,
        ),
      );
      expect(response.status).toBe(400);
    }
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('purges allowlisted tags and reports them', async () => {
    const cache = makeCache();
    const response = await POST(
      makeContext(
        makeRequest(
          { tags: ['catalogue', 'developers'] },
          { authorization: `Bearer ${SECRET}` },
        ),
        makeEnv(),
        cache,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      purged: ['catalogue', 'developers'],
    });
    expect(cache.invalidate).toHaveBeenCalledWith({
      tags: ['catalogue', 'developers'],
    });
  });

  it('reports success without purging when the cache is disabled', async () => {
    const cache = { ...makeCache(), enabled: false };
    const response = await POST(
      makeContext(
        makeRequest(
          { tags: ['catalogue'] },
          { authorization: `Bearer ${SECRET}` },
        ),
        makeEnv(),
        cache,
      ),
    );

    expect(response.status).toBe(200);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });
});
