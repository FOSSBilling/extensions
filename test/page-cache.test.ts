import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheRenderedPage, matchCachedPage } from '@/lib/page-cache';

function fakeEdgeCache() {
  const entries = new Map<string, { body: string; headers: Headers }>();
  return {
    entries,
    match: vi.fn(async (key: Request) => {
      const entry = entries.get(key.url);
      return entry
        ? new Response(entry.body, { headers: entry.headers })
        : undefined;
    }),
    put: vi.fn(async (key: Request, response: Response) => {
      entries.set(key.url, {
        body: await response.clone().text(),
        headers: response.headers,
      });
    }),
  };
}

function stubEdgeCache() {
  const cache = fakeEdgeCache();
  vi.stubGlobal('caches', { default: cache });
  return cache;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function htmlRequest(url: string, method = 'GET'): Request {
  return new Request(url, { method });
}

function htmlResponse(body = '<html></html>', status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

describe('matchCachedPage', () => {
  it('serves a previously stored page', async () => {
    const cache = stubEdgeCache();
    const request = htmlRequest('https://extensions.example.test/');
    await cacheRenderedPage(request, htmlResponse());

    const hit = await matchCachedPage(request);
    expect(hit).toBeInstanceOf(Response);
    expect(await hit?.text()).toBe('<html></html>');
    expect(cache.match).toHaveBeenCalledOnce();
  });

  it('ignores non-GET requests', async () => {
    stubEdgeCache();
    expect(
      await matchCachedPage(
        htmlRequest('https://extensions.example.test/developer/abc', 'POST'),
      ),
    ).toBeUndefined();
  });

  it('ignores paths outside the public catalogue allowlist', async () => {
    stubEdgeCache();
    for (const path of [
      '/account',
      '/account/admin',
      '/auth/login',
      '/api/extensions',
      '/images/icon',
      '/_server-islands/HeaderAccount',
    ]) {
      expect(
        await matchCachedPage(
          htmlRequest(`https://extensions.example.test${path}`),
        ),
      ).toBeUndefined();
    }
  });

  it('returns undefined when no edge cache is available', async () => {
    expect(
      await matchCachedPage(htmlRequest('https://extensions.example.test/')),
    ).toBeUndefined();
  });
});

describe('cacheRenderedPage', () => {
  it('stores catalogue pages with a short shared TTL', async () => {
    const cache = stubEdgeCache();
    for (const path of ['/', '/extension/example', '/developer/example']) {
      await cacheRenderedPage(
        htmlRequest(`https://extensions.example.test${path}`),
        htmlResponse(),
      );
    }

    expect(cache.put).toHaveBeenCalledTimes(3);
    for (const [key, stored] of cache.put.mock.calls as [Request, Response][]) {
      expect(stored.headers.get('cache-control')).toBe('public, s-maxage=60');
      expect(key.method).toBe('GET');
    }
  });

  it('skips non-200 responses such as rewritten 404 pages', async () => {
    const cache = stubEdgeCache();
    await cacheRenderedPage(
      htmlRequest('https://extensions.example.test/extension/missing'),
      htmlResponse('not found', 404),
    );
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('skips non-HTML responses', async () => {
    const cache = stubEdgeCache();
    await cacheRenderedPage(
      htmlRequest('https://extensions.example.test/api/extensions'),
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('never caches responses that set cookies', async () => {
    const cache = stubEdgeCache();
    const response = htmlResponse();
    response.headers.set('set-cookie', 'fb_session=leaked');
    await cacheRenderedPage(
      htmlRequest('https://extensions.example.test/'),
      response,
    );
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('skips non-GET requests', async () => {
    const cache = stubEdgeCache();
    await cacheRenderedPage(
      htmlRequest('https://extensions.example.test/developer/abc', 'POST'),
      htmlResponse(),
    );
    expect(cache.put).not.toHaveBeenCalled();
  });
});
