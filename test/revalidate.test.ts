import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/pages/api/revalidate';
import type { ApplicationEnv } from '@/lib/runtime';
import { makeEnv } from './helpers/env';

const cacheMocks = vi.hoisted(() => ({ markEdgeCachePurged: vi.fn() }));

vi.mock('@/lib/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cache')>()),
  markEdgeCachePurged: cacheMocks.markEdgeCachePurged,
}));

beforeEach(() => {
  // mockReset also drops implementations set by earlier tests (the purge
  // test's order recorder), restoring the plain no-op mock.
  cacheMocks.markEdgeCachePurged.mockReset();
});

const SECRET = 'test-revalidate-secret';

function makeRevalidateEnv(overrides = {}): ReturnType<typeof makeEnv> {
  return makeEnv({
    revalidateSecret: SECRET,
    ...overrides,
  });
}

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
  url = 'https://extensions.example.test/api/revalidate',
): Request {
  return new Request(url, {
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
      makeContext(
        makeRequest({ tags: ['catalogue'] }),
        makeRevalidateEnv(),
        cache,
      ),
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
        makeRevalidateEnv(),
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
        makeRevalidateEnv({ revalidateSecret: '' }),
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
        makeRevalidateEnv(),
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
          makeRevalidateEnv(),
          cache,
        ),
      );
      expect(response.status).toBe(400);
    }
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('purges allowlisted tags and reports them', async () => {
    // The purge marker must land before the CDN invalidation: it is what
    // ages out same-isolate data-cache entries after the purge — dropping
    // it (or reordering) would silently break freshness.
    const order: string[] = [];
    cacheMocks.markEdgeCachePurged.mockImplementation(() => {
      order.push('marker');
    });
    const cache = makeCache();
    cache.invalidate.mockImplementation(async () => {
      order.push('invalidate');
    });
    const response = await POST(
      makeContext(
        makeRequest(
          { tags: ['catalogue', 'developers'] },
          { authorization: `Bearer ${SECRET}` },
        ),
        makeRevalidateEnv(),
        cache,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      purged: ['catalogue', 'developers'],
    });
    expect(order).toEqual(['marker', 'invalidate']);
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
        makeRevalidateEnv(),
        cache,
      ),
    );

    expect(response.status).toBe(200);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('returns 502 PURGE_FAILED when invalidation rejects', async () => {
    const cache = makeCache();
    cache.invalidate.mockRejectedValueOnce(new Error('purge unavailable'));
    const response = await POST(
      makeContext(
        makeRequest(
          { tags: ['catalogue'] },
          { authorization: `Bearer ${SECRET}` },
        ),
        makeRevalidateEnv(),
        cache,
      ),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'PURGE_FAILED' },
    });
  });

  it('surfaces a production purge-not-a-function TypeError as 502', async () => {
    const cache = makeCache();
    cache.invalidate.mockRejectedValueOnce(
      new TypeError('cache.purge is not a function'),
    );
    const response = await POST(
      makeContext(
        makeRequest(
          { tags: ['catalogue'] },
          { authorization: `Bearer ${SECRET}` },
        ),
        makeRevalidateEnv(),
        cache,
      ),
    );

    // Only an explicitly local runtime may treat this as benign.
    expect(response.status).toBe(502);
  });

  it('treats the local-runtime purge TypeError as success', async () => {
    const cache = makeCache();
    cache.invalidate.mockRejectedValueOnce(
      new TypeError('cache.purge is not a function'),
    );
    const response = await POST(
      makeContext(
        makeRequest(
          { tags: ['catalogue'] },
          { authorization: `Bearer ${SECRET}` },
          'http://localhost:4321/api/revalidate',
        ),
        makeRevalidateEnv(),
        cache,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      purged: ['catalogue'],
      cache: 'purge-unavailable-locally',
    });
  });
});
