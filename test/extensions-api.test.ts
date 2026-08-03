import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  clampExtensionPageLimit,
  ExtensionsApiError,
  getExtensionById,
  listExtensions,
  type Extension,
  type ExtensionListItem,
  type ExtensionListResponse,
} from '@/lib/extensionsApi';
import {
  createCataloguePager,
  type CataloguePageRequest,
} from '@/lib/cataloguePagination';

const env = {
  EXTENSIONS_API_BASE_URL: 'https://api.example.test',
} as Cloudflare.Env;

function apiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function item(id: string, name = id): ExtensionListItem {
  return {
    id,
    type: 'mod',
    name,
    description: `${name} description`,
    website: `https://example.test/${id}`,
    license: { name: 'MIT' },
    source: { type: 'github', repo: `fossbilling/${id}` },
    version: '1.0.0',
    download_url: `https://example.test/${id}.zip`,
    developer: {
      id: 'fossbilling',
      type: 'organization',
      name: 'FOSSBilling',
      approved: true,
    },
  };
}

function page(
  result: ExtensionListItem[],
  next_cursor: string | null,
  has_more: boolean,
): ExtensionListResponse {
  return { result, pagination: { next_cursor, has_more } };
}

function requestUrl(fetchMock: ReturnType<typeof vi.fn>): URL {
  const request = fetchMock.mock.calls[0]?.[0];
  return new URL(request instanceof Request ? request.url : String(request));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generated Extensions v2 catalogue client', () => {
  it('uses the bounded default limit, omits the first cursor, and consumes result items', async () => {
    const firstPage = page([item('first')], 'opaque-page-2', true);
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(firstPage));
    vi.stubGlobal('fetch', fetchMock);

    const response = await listExtensions(env);
    const url = requestUrl(fetchMock);

    expect(url.pathname).toBe('/extensions/v2/extensions');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(response.result).toEqual(firstPage.result);
    expect(response.pagination).toEqual(firstPage.pagination);
    expect(response.result[0]).not.toHaveProperty('readme');
    expect(response.result[0]).not.toHaveProperty('releases');
  });

  it('sends limit 100 and clamps larger values instead of sending them', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(apiResponse(page([], null, false))),
      );
    vi.stubGlobal('fetch', fetchMock);

    await listExtensions(env, { limit: 100 });
    expect(requestUrl(fetchMock).searchParams.get('limit')).toBe('100');

    await listExtensions(env, { limit: 101 });
    const secondRequest = fetchMock.mock.calls[1]?.[0] as Request;
    expect(new URL(secondRequest.url).searchParams.get('limit')).toBe('100');
    expect(clampExtensionPageLimit(0)).toBe(1);
    expect(clampExtensionPageLimit(101)).toBe(100);
  });

  it('preserves filters and the exact opaque cursor on later requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(apiResponse(page([], null, false)));
    vi.stubGlobal('fetch', fetchMock);
    const opaqueCursor = 'cursor/with?opaque=characters';

    await listExtensions(env, {
      type: 'theme',
      developer_id: 'developer-id',
      limit: 100,
      cursor: opaqueCursor,
    });

    const url = requestUrl(fetchMock);
    expect(url.searchParams.get('type')).toBe('theme');
    expect(url.searchParams.get('developer_id')).toBe('developer-id');
    expect(url.searchParams.get('cursor')).toBe(opaqueCursor);
  });

  it('returns the complete detail DTO, including README and releases', async () => {
    const detail: Extension = {
      ...item('full-extension'),
      readme: '# Full extension\n\nREADME content',
      releases: [
        {
          tag: '1.0.0',
          date: '2026-01-01T00:00:00Z',
          download_url: 'https://example.test/full-extension-1.0.0.zip',
          min_fossbilling_version: '0.6.0',
        },
        {
          tag: '0.9.0',
          date: '2025-12-01T00:00:00Z',
          download_url: 'https://example.test/full-extension-0.9.0.zip',
          changelog_url: 'https://example.test/changelog/0.9.0',
          min_fossbilling_version: '0.5.0',
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(apiResponse({ result: detail }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await getExtensionById(env, 'full-extension');
    const request = fetchMock.mock.calls[0]?.[0] as Request;

    expect(request.url).toBe(
      'https://api.example.test/extensions/v2/extensions/full-extension',
    );
    expect(response.readme).toContain('README content');
    expect(response.releases).toHaveLength(2);
    expect(response.source.repo).toBe('fossbilling/full-extension');
    expect(response.version).toBe('1.0.0');
    expect(response.download_url).toContain('full-extension.zip');
    expect(response.developer.id).toBe('fossbilling');
  });

  it('surfaces a 422 invalid cursor as an API error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        apiResponse(
          { error: { code: 'INVALID_CURSOR', message: 'Cursor is invalid.' } },
          422,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      listExtensions(env, { cursor: 'invalid-cursor' }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_CURSOR',
      message: 'Cursor is invalid.',
    });
  });

  it('keeps list consumers on ExtensionListItem rather than Extension', () => {
    expectTypeOf<ExtensionListItem[]>().toEqualTypeOf<
      ExtensionListResponse['result']
    >();
  });
});

describe('catalogue page accumulation', () => {
  const filters = {
    type: 'mod' as const,
    developer_id: 'developer-id',
    limit: 100,
  };

  it('appends middle pages in API order, preserves existing items, and replaces the cursor', async () => {
    const first = page(
      [item('zeta', 'Zulu'), item('alpha', 'Alpha')],
      'cursor-2',
      true,
    );
    const second = page(
      [item('beta', 'beta'), item('ALPHA', 'alpha duplicate')],
      'cursor-3',
      true,
    );
    const loadPage = vi.fn().mockResolvedValue(second);
    const pager = createCataloguePager(first, filters, loadPage);

    const state = await pager.loadNextPage();

    expect(loadPage).toHaveBeenCalledWith({
      ...filters,
      cursor: 'cursor-2',
    } satisfies CataloguePageRequest);
    expect(state.items.map((extension) => extension.id)).toEqual([
      'zeta',
      'alpha',
      'beta',
    ]);
    expect(state.nextCursor).toBe('cursor-3');
    expect(state.hasMore).toBe(true);
  });

  it('does not duplicate concurrent next-page requests', async () => {
    let resolvePage: ((value: ExtensionListResponse) => void) | undefined;
    const loadPage = vi.fn(
      () =>
        new Promise<ExtensionListResponse>((resolve) => {
          resolvePage = resolve;
        }),
    );
    const pager = createCataloguePager(
      page([item('first')], 'cursor-2', true),
      filters,
      loadPage,
    );

    const firstRequest = pager.loadNextPage();
    const duplicateRequest = pager.loadNextPage();
    expect(loadPage).toHaveBeenCalledTimes(1);

    resolvePage?.(page([item('second')], null, false));
    await Promise.all([firstRequest, duplicateRequest]);

    expect(pager.getState().items.map((extension) => extension.id)).toEqual([
      'first',
      'second',
    ]);
  });

  it('appends a final page and offers no further request', async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce(page([item('last')], null, false));
    const pager = createCataloguePager(
      page([item('first')], 'cursor-final', true),
      filters,
      loadPage,
    );

    const state = await pager.loadNextPage();
    await pager.loadNextPage();

    expect(state.items.map((extension) => extension.id)).toEqual([
      'first',
      'last',
    ]);
    expect(state.hasMore).toBe(false);
    expect(state.nextCursor).toBeNull();
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it('retains loaded results and does not reset or retry after an invalid cursor', async () => {
    const invalidCursor = new ExtensionsApiError(
      422,
      'INVALID_CURSOR',
      'Cursor is invalid.',
    );
    const loadPage = vi.fn().mockRejectedValue(invalidCursor);
    const pager = createCataloguePager(
      page([item('first')], 'invalid-cursor', true),
      filters,
      loadPage,
    );

    const state = await pager.loadNextPage();

    expect(state.items.map((extension) => extension.id)).toEqual(['first']);
    expect(state.nextCursor).toBe('invalid-cursor');
    expect(state.hasMore).toBe(true);
    expect(state.error).toBe(invalidCursor);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });
});
