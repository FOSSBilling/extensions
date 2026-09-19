import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedEdgeRead, dataCacheKey, markEdgeCachePurged } from '@/lib/cache';

const PRODUCER_VALUE = {
  result: ['extension-1'],
  pagination: { has_more: false },
};

function fakeEdgeCache() {
  const entries = new Map<string, { body: string; headers: Headers }>();
  const match = vi.fn(async (key: Request) => {
    const entry = entries.get(key.url);
    return entry
      ? new Response(entry.body, { headers: entry.headers })
      : undefined;
  });
  const put = vi.fn(async (key: Request, response: Response) => {
    entries.set(key.url, {
      body: await response.clone().text(),
      headers: response.headers,
    });
  });
  return { entries, match, put };
}

function stubEdgeCache() {
  const cache = fakeEdgeCache();
  vi.stubGlobal('caches', { default: cache });
  return cache;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dataCacheKey', () => {
  it('builds a stable normalized key from present params', () => {
    const key = dataCacheKey('extensions', {
      type: 'module',
      limit: 50,
      cursor: undefined,
    });
    expect(key.method).toBe('GET');
    expect(key.url).toBe(
      'https://extensions.fossbilling.org/_edge-cache/extensions?limit=50&type=module',
    );
  });

  it('builds a key without a query when no params are given', () => {
    expect(dataCacheKey('extension/abc').url).toBe(
      'https://extensions.fossbilling.org/_edge-cache/extension/abc',
    );
  });
});

describe('cachedEdgeRead', () => {
  it('falls through to the producer when no edge cache exists', async () => {
    const producer = vi.fn().mockResolvedValue(PRODUCER_VALUE);

    await expect(
      cachedEdgeRead(dataCacheKey('extensions'), producer),
    ).resolves.toEqual(PRODUCER_VALUE);
    expect(producer).toHaveBeenCalledOnce();
  });

  it('stores producer results and serves later calls from the cache', async () => {
    const cache = stubEdgeCache();
    const producer = vi.fn().mockResolvedValue(PRODUCER_VALUE);
    const key = dataCacheKey('extensions', { limit: 50 });

    await expect(cachedEdgeRead(key, producer)).resolves.toEqual(
      PRODUCER_VALUE,
    );
    await expect(cachedEdgeRead(key, producer)).resolves.toEqual(
      PRODUCER_VALUE,
    );

    expect(producer).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();

    const [, stored] = cache.put.mock.calls[0] as [Request, Response];
    expect(stored.headers.get('cache-control')).toBe('public, s-maxage=60');
    expect(stored.headers.get('content-type')).toBe('application/json');
    // Entries are stored as { writtenAt, value } so purges can age them out
    // — the envelope's writtenAt is load-bearing for that check.
    const envelope = (await stored.json()) as {
      writtenAt: number;
      value: unknown;
    };
    expect(envelope.value).toEqual(PRODUCER_VALUE);
    expect(typeof envelope.writtenAt).toBe('number');
  });

  it('never caches producer failures', async () => {
    const cache = stubEdgeCache();
    const producer = vi.fn().mockRejectedValue(new Error('api down'));

    await expect(
      cachedEdgeRead(dataCacheKey('extensions'), producer),
    ).rejects.toThrow('api down');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('still serves the producer value when the cache write fails', async () => {
    stubEdgeCache();
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockRejectedValue(new Error('quota')),
      },
    });
    const producer = vi.fn().mockResolvedValue(PRODUCER_VALUE);

    await expect(
      cachedEdgeRead(dataCacheKey('extensions'), producer),
    ).resolves.toEqual(PRODUCER_VALUE);
  });

  it('treats an unreadable cache entry as a miss', async () => {
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn().mockRejectedValue(new Error('corrupt')),
        put: vi.fn(),
      },
    });
    const producer = vi.fn().mockResolvedValue(PRODUCER_VALUE);

    await expect(
      cachedEdgeRead(dataCacheKey('extensions'), producer),
    ).resolves.toEqual(PRODUCER_VALUE);
    expect(producer).toHaveBeenCalledOnce();
  });

  // A present-but-corrupt entry (body no longer parses as the writtenAt
  // envelope) must also fall back to the producer rather than throwing.
  it('treats a malformed cache entry body as a miss', async () => {
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn().mockResolvedValue(new Response('not-json')),
        put: vi.fn(),
      },
    });
    const producer = vi.fn().mockResolvedValue(PRODUCER_VALUE);

    await expect(
      cachedEdgeRead(dataCacheKey('extensions'), producer),
    ).resolves.toEqual(PRODUCER_VALUE);
    expect(producer).toHaveBeenCalledOnce();
  });

  // Deterministic via fake timers: writes are stamped with the miss-start
  // time, so the clock must advance between the purge and the repopulating
  // read for the new entry to count as post-purge.
  it('skips entries written before the last purge and repopulates', async () => {
    vi.useFakeTimers();
    const producerValue = { fresh: true };
    let stored: Response | undefined;
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn(async () => stored),
        put: vi.fn(async (_key: Request, response: Response) => {
          stored = response.clone();
        }),
      },
    });
    const producer = vi.fn().mockResolvedValue({ stale: true });

    // Populate the cache at T0.
    await cachedEdgeRead(dataCacheKey('extensions'), producer);
    expect(producer).toHaveBeenCalledTimes(1);

    // A purge lands at T1 (after the entry was written): the stale entry
    // must be skipped and the producer re-run.
    vi.setSystemTime(Date.now() + 1000);
    markEdgeCachePurged();
    const freshProducer = vi.fn().mockResolvedValue(producerValue);
    vi.setSystemTime(Date.now() + 5000);
    await expect(
      cachedEdgeRead(dataCacheKey('extensions'), freshProducer),
    ).resolves.toEqual(producerValue);
    expect(freshProducer).toHaveBeenCalledOnce();

    // The fresh result must replace the stale entry in the cache — its
    // envelope is stamped post-purge, so the next read is served without
    // re-running the producer. (Read the stored entry through a clone:
    // `match` hands the same Response to the reads below.)
    expect(stored).toBeDefined();
    const envelope = (await stored!.clone().json()) as {
      writtenAt: number;
      value: unknown;
    };
    expect(envelope.value).toEqual(producerValue);
    expect(envelope.writtenAt).toBeGreaterThan(Date.now() - 5000);
    await expect(
      cachedEdgeRead(dataCacheKey('extensions'), freshProducer),
    ).resolves.toEqual(producerValue);
    expect(freshProducer).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
