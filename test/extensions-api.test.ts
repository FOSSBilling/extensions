import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest';

vi.mock('@/lib/assertion', () => ({
  mintBearerAssertion: vi.fn(),
}));

import {
  ApiRequestError,
  clampApiPageLimit,
  clampExtensionPageLimit,
  createApiClient,
  getExtensionById,
  listExtensions,
  type Extension,
  type ExtensionCreate,
  type ExtensionListItem,
  type ExtensionListResponse,
  type ExtensionRevision,
  type ModerationQueuePage,
  type OwnedExtensionListResponse,
  type RevisionHistoryPage,
} from '@/lib/api/client';
import { mintBearerAssertion } from '@/lib/assertion';
import { isCatalogueCardPage } from '@/scripts/extension-catalogue';
import { isDeveloperType, isExtensionType, isSourceType } from '@/types';
import type {
  DeveloperProfile as LocalDeveloperProfile,
  Extension as LocalExtension,
} from '@/types';
import {
  appendPage,
  createCataloguePager,
  createCataloguePagerFromIds,
  stateFromPage,
  type CataloguePageRequest,
} from '@/lib/cataloguePagination';
import {
  cursorPageUrl,
  filterPageUrl,
  prevCursorPageUrl,
} from '@/lib/pagination';
import type { ApplicationEnv } from '@/lib/runtime';

const publicEnv: ApplicationEnv = {
  extensionsApi: {
    baseUrl: 'https://api.example.test',
    fetch: (...args) => globalThis.fetch(...args),
  },
  authClientId: 'test-client',
  authClientSecret: 'test-secret',
  sessionSecret: 'test-session-secret',
  assertionSigningSecret: '',
};

const authenticatedEnv: ApplicationEnv = {
  ...publicEnv,
  assertionSigningSecret: 'test-secret',
};

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
      unclaimed: false,
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

function ownedExtensionsPage(
  next_cursor: string | null,
  has_more: boolean,
): OwnedExtensionListResponse {
  return { result: [], pagination: { next_cursor, has_more } };
}

function moderationPage(
  next_cursor: string | null,
  has_more: boolean,
): ModerationQueuePage {
  return { result: [], pagination: { next_cursor, has_more } };
}

function requestFrom(fetchMock: ReturnType<typeof vi.fn>, index = 0): Request {
  return fetchMock.mock.calls[index]?.[0] as Request;
}

function requestUrl(fetchMock: ReturnType<typeof vi.fn>, index = 0): URL {
  return new URL(requestFrom(fetchMock, index).url);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(mintBearerAssertion).mockResolvedValue('test-token');
});

describe('generated Extensions v2 façade', () => {
  it('uses the injected transport instead of ambient global fetch', async () => {
    const transportFetch = vi
      .fn()
      .mockResolvedValue(apiResponse(page([], null, false)));
    const ambientFetch = vi
      .fn()
      .mockRejectedValue(new Error('ambient fetch must not be used'));
    vi.stubGlobal('fetch', ambientFetch);

    await listExtensions({
      ...publicEnv,
      extensionsApi: {
        ...publicEnv.extensionsApi,
        fetch: transportFetch,
      },
    });

    expect(transportFetch).toHaveBeenCalledTimes(1);
    expect(ambientFetch).not.toHaveBeenCalled();
  });

  it('does not retry a rejected transport through HTTP', async () => {
    const bindingFetch = vi
      .fn()
      .mockRejectedValue(new Error('binding unavailable'));
    const httpFetch = vi.fn();
    vi.stubGlobal('fetch', httpFetch);

    await expect(
      listExtensions({
        ...publicEnv,
        extensionsApi: {
          ...publicEnv.extensionsApi,
          fetch: bindingFetch,
        },
      }),
    ).rejects.toThrow('binding unavailable');

    expect(bindingFetch).toHaveBeenCalledTimes(1);
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it('keeps binding and HTTP transports request-compatible', async () => {
    const bindingFetch = vi
      .fn()
      .mockResolvedValue(apiResponse(page([], null, false)));
    const httpFetch = vi
      .fn()
      .mockResolvedValue(apiResponse(page([], null, false)));
    const request = {
      type: 'theme' as const,
      developer_id: 'developer-id',
      limit: 25,
      cursor: 'opaque-cursor',
    };

    await listExtensions(
      {
        ...publicEnv,
        extensionsApi: { ...publicEnv.extensionsApi, fetch: bindingFetch },
      },
      request,
    );
    await listExtensions(
      {
        ...publicEnv,
        extensionsApi: { ...publicEnv.extensionsApi, fetch: httpFetch },
      },
      request,
    );

    const bindingRequest = requestFrom(bindingFetch);
    const httpRequest = requestFrom(httpFetch);
    expect(bindingRequest.method).toBe(httpRequest.method);
    expect(bindingRequest.url).toBe(httpRequest.url);
    expect([...bindingRequest.headers]).toEqual([...httpRequest.headers]);
    expect(await bindingRequest.text()).toBe(await httpRequest.text());
  });

  it('keeps authenticated binding and HTTP transports request-compatible', async () => {
    const bindingFetch = vi
      .fn()
      .mockResolvedValue(apiResponse(ownedExtensionsPage(null, false)));
    const httpFetch = vi
      .fn()
      .mockResolvedValue(apiResponse(ownedExtensionsPage(null, false)));
    const options = { limit: 25, cursor: 'opaque-cursor' };

    await createApiClient(
      {
        ...authenticatedEnv,
        extensionsApi: {
          ...authenticatedEnv.extensionsApi,
          fetch: bindingFetch,
        },
      },
      'user-id',
    ).listMyExtensions(options);
    await createApiClient(
      {
        ...authenticatedEnv,
        extensionsApi: {
          ...authenticatedEnv.extensionsApi,
          fetch: httpFetch,
        },
      },
      'user-id',
    ).listMyExtensions(options);

    const bindingRequest = requestFrom(bindingFetch);
    const httpRequest = requestFrom(httpFetch);
    expect(bindingRequest.method).toBe(httpRequest.method);
    expect(bindingRequest.url).toBe(httpRequest.url);
    expect([...bindingRequest.headers]).toEqual([...httpRequest.headers]);
    expect(bindingRequest.headers.get('authorization')).toBe(
      'Bearer test-token',
    );
    expect(await bindingRequest.text()).toBe(await httpRequest.text());
  });

  it('uses the bounded default limit, omits the first cursor, and consumes result items', async () => {
    const firstPage = page([item('first')], 'opaque-page-2', true);
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(firstPage));
    vi.stubGlobal('fetch', fetchMock);

    const response = await listExtensions(publicEnv);
    const url = requestUrl(fetchMock);

    expect(url.pathname).toBe('/extensions/v2/extensions');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(response.result).toEqual(firstPage.result);
    expect(response.pagination).toEqual(firstPage.pagination);
    expect(response.result[0]).not.toHaveProperty('readme');
    expect(response.result[0]).not.toHaveProperty('releases');
    expect(requestFrom(fetchMock).headers.get('authorization')).toBeNull();
  });

  it('sends limit 100 and clamps larger values instead of sending them', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(apiResponse(page([], null, false))),
      );
    vi.stubGlobal('fetch', fetchMock);

    await listExtensions(publicEnv, { limit: 100 });
    await listExtensions(publicEnv, { limit: 101 });

    expect(requestUrl(fetchMock, 0).searchParams.get('limit')).toBe('100');
    expect(requestUrl(fetchMock, 1).searchParams.get('limit')).toBe('100');
    expect(clampApiPageLimit(0)).toBe(1);
    expect(clampExtensionPageLimit(101)).toBe(100);
  });

  it('preserves filters and the exact opaque cursor on later requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(apiResponse(page([], null, false)));
    vi.stubGlobal('fetch', fetchMock);
    const opaqueCursor = 'cursor/with?opaque=characters';

    await listExtensions(publicEnv, {
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

  it('returns the complete detail DTO by ID', async () => {
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

    const response = await getExtensionById(publicEnv, 'full-extension');

    expect(requestFrom(fetchMock).url).toBe(
      'https://api.example.test/extensions/v2/extensions/full-extension',
    );
    expect(response.readme).toContain('README content');
    expect(response.releases).toHaveLength(2);
    expect(response.source.repo).toBe('fossbilling/full-extension');
    expect(response.version).toBe('1.0.0');
    expect(response.download_url).toContain('full-extension.zip');
    expect(response.developer.id).toBe('fossbilling');
  });

  it('uses generated serialization and a fresh bearer callback for authenticated requests', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(apiResponse(ownedExtensionsPage(null, false))),
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(mintBearerAssertion)
      .mockResolvedValueOnce('token-one')
      .mockResolvedValueOnce('token-two');

    const api = createApiClient(authenticatedEnv, 'user-sub');
    await api.listMyExtensions({ limit: 100, cursor: 'opaque cursor' });
    await api.listMyExtensions({ limit: 100 });

    expect(mintBearerAssertion).toHaveBeenCalledTimes(2);
    expect(mintBearerAssertion).toHaveBeenNthCalledWith(
      1,
      'user-sub',
      'test-secret',
    );
    expect(requestFrom(fetchMock, 0).headers.get('authorization')).toBe(
      'Bearer token-one',
    );
    expect(requestFrom(fetchMock, 1).headers.get('authorization')).toBe(
      'Bearer token-two',
    );
    expect(requestUrl(fetchMock, 0).pathname).toBe(
      '/extensions/v2/extensions/mine',
    );
    expect(requestUrl(fetchMock, 0).searchParams.get('limit')).toBe('100');
    expect(requestUrl(fetchMock, 0).searchParams.get('cursor')).toBe(
      'opaque cursor',
    );
    expect(requestUrl(fetchMock, 1).searchParams.has('cursor')).toBe(false);
  });

  it('keeps owner extension listing query separate from public filters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(apiResponse(page([], null, false)));
    vi.stubGlobal('fetch', fetchMock);

    await createApiClient(authenticatedEnv, 'user-sub').listMyExtensions({
      type: 'theme',
      limit: 100,
      cursor: 'mine-cursor',
    });

    const url = requestUrl(fetchMock);
    expect(url.pathname).toBe('/extensions/v2/extensions/mine');
    expect(url.searchParams.get('type')).toBe('theme');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('cursor')).toBe('mine-cursor');
    expect(url.searchParams.has('developer_id')).toBe(false);
  });

  it('serializes a create payload with no developer field and reports the new revision', async () => {
    const payload = {
      id: 'body-extension',
      type: 'mod' as const,
      name: 'Body extension',
      description: 'Submitted through the generated client.',
      releases: [],
      website: 'https://example.test/body-extension',
      license: { name: 'MIT' },
      readme: '# Body extension',
      source: { type: 'github' as const, repo: 'fossbilling/body-extension' },
      version: '1.0.0',
      download_url: 'https://example.test/body-extension.zip',
    } satisfies ExtensionCreate;
    const fetchMock = vi.fn().mockResolvedValue(
      apiResponse(
        {
          result: {
            id: 'body-extension',
            revision_id: 'revision-1',
            status: 'pending',
          },
        },
        201,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createApiClient(
      authenticatedEnv,
      'user-sub',
    ).createExtension(payload);

    const request = requestFrom(fetchMock);
    expect(new URL(request.url).pathname).toBe('/extensions/v2/extensions');
    expect(request.method).toBe('POST');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(await request.json()).toEqual(payload);
    expect(result).toEqual({
      id: 'body-extension',
      revision_id: 'revision-1',
      status: 'pending',
    });
  });

  it('sends an edit as PUT and reads the 202 pending-revision result', async () => {
    const payload = {
      type: 'mod' as const,
      name: 'Body extension',
      description: 'Edited through the generated client.',
      releases: [],
      website: 'https://example.test/body-extension',
      license: { name: 'MIT' },
      readme: '# Body extension',
      source: { type: 'github' as const, repo: 'fossbilling/body-extension' },
      version: '1.1.0',
      download_url: 'https://example.test/body-extension-1.1.0.zip',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      apiResponse(
        {
          result: {
            id: 'body-extension',
            revision_id: 'revision-2',
            status: 'pending',
          },
        },
        202,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createApiClient(
      authenticatedEnv,
      'user-sub',
    ).updateExtension('body-extension', payload);

    const request = requestFrom(fetchMock);
    expect(new URL(request.url).pathname).toBe(
      '/extensions/v2/extensions/body-extension',
    );
    expect(request.method).toBe('PUT');
    expect(await request.json()).toEqual(payload);
    expect(result.revision_id).toBe('revision-2');
  });

  it('withdraws an unpublished extension with DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      apiResponse({
        result: { id: 'body-extension', deleted: true },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createApiClient(
      authenticatedEnv,
      'user-sub',
    ).withdrawExtension('body-extension');

    const request = requestFrom(fetchMock);
    expect(new URL(request.url).pathname).toBe(
      '/extensions/v2/extensions/body-extension',
    );
    expect(request.method).toBe('DELETE');
    expect(result).toEqual({ id: 'body-extension', deleted: true });
  });

  it('lists an extension revision history by id, oldest params preserved', async () => {
    const historyPage: RevisionHistoryPage = {
      result: [],
      pagination: { next_cursor: 'history-2', has_more: true },
    };
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(historyPage));
    vi.stubGlobal('fetch', fetchMock);

    const response = await createApiClient(
      authenticatedEnv,
      'user-sub',
    ).listExtensionRevisions('body-extension', {
      limit: 25,
      cursor: 'history-cursor',
    });

    const url = requestUrl(fetchMock);
    expect(url.pathname).toBe(
      '/extensions/v2/extensions/body-extension/revisions',
    );
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('cursor')).toBe('history-cursor');
    expect(response.pagination).toEqual(historyPage.pagination);
  });

  it('approves and rejects a revision by extension id + revision id', async () => {
    const approveFetch = vi
      .fn()
      .mockResolvedValue(
        apiResponse({ result: { id: 'r-1', status: 'approved' } }),
      );
    vi.stubGlobal('fetch', approveFetch);
    await createApiClient(authenticatedEnv, 'moderator-sub').approveRevision(
      'body-extension',
      'r-1',
      'looks good',
    );
    const approveRequest = requestFrom(approveFetch);
    expect(new URL(approveRequest.url).pathname).toBe(
      '/extensions/v2/extensions/body-extension/revisions/r-1/approve',
    );
    expect(await approveRequest.json()).toEqual({ review_note: 'looks good' });

    const rejectFetch = vi
      .fn()
      .mockResolvedValue(
        apiResponse({ result: { id: 'r-2', status: 'rejected' } }),
      );
    vi.stubGlobal('fetch', rejectFetch);
    await createApiClient(authenticatedEnv, 'moderator-sub').rejectRevision(
      'body-extension',
      'r-2',
      'needs work',
    );
    const rejectRequest = requestFrom(rejectFetch);
    expect(new URL(rejectRequest.url).pathname).toBe(
      '/extensions/v2/extensions/body-extension/revisions/r-2/reject',
    );
    expect(await rejectRequest.json()).toEqual({ review_note: 'needs work' });
  });

  it('returns moderation queue pagination and preserves status/cursor filters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(apiResponse(moderationPage('next-page', true)));
    vi.stubGlobal('fetch', fetchMock);

    const response = await createApiClient(
      authenticatedEnv,
      'moderator-sub',
    ).listModerationQueue('approved', { limit: 100, cursor: 'queue-cursor' });

    expect(response.pagination).toEqual({
      next_cursor: 'next-page',
      has_more: true,
    });
    expect(requestUrl(fetchMock).searchParams.get('status')).toBe('approved');
    expect(requestUrl(fetchMock).searchParams.get('cursor')).toBe(
      'queue-cursor',
    );
  });

  it('normalizes structured, invalid-json, and network failures to one error type', async () => {
    const structuredFetch = vi.fn().mockResolvedValue(
      apiResponse(
        {
          error: {
            code: 'INVALID_CURSOR',
            message: 'Cursor is invalid.',
            details: ['expired'],
          },
        },
        422,
      ),
    );
    vi.stubGlobal('fetch', structuredFetch);

    const structuredError = listExtensions(publicEnv, {
      cursor: 'invalid-cursor',
    });
    await expect(structuredError).rejects.toBeInstanceOf(ApiRequestError);
    await expect(structuredError).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_CURSOR',
      message: 'Cursor is invalid.',
      details: ['expired'],
    });

    const invalidJsonFetch = vi
      .fn()
      .mockResolvedValue(new Response('not-json', { status: 500 }));
    vi.stubGlobal('fetch', invalidJsonFetch);
    const invalidJsonError = listExtensions(publicEnv);
    await expect(invalidJsonError).rejects.toBeInstanceOf(ApiRequestError);
    await expect(invalidJsonError).rejects.toMatchObject({
      status: 500,
      code: 'request_failed',
    });

    const networkFetch = vi
      .fn()
      .mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', networkFetch);
    await expect(listExtensions(publicEnv)).rejects.toBeInstanceOf(
      ApiRequestError,
    );
  });

  it('keeps list consumers on ExtensionListItem rather than Extension', () => {
    expectTypeOf<ExtensionListItem[]>().toEqualTypeOf<
      ExtensionListResponse['result']
    >();
    expectTypeOf<
      'readme' extends keyof ExtensionListItem ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'releases' extends keyof ExtensionListItem ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<Extension>().toHaveProperty('readme');
    expectTypeOf<Extension>().toHaveProperty('releases');
  });

  it('keeps private developer contact data out of local public extension models', () => {
    expectTypeOf<
      'contact_email' extends keyof LocalExtension['developer'] ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'contact_email' extends keyof LocalDeveloperProfile ? true : false
    >().toEqualTypeOf<true>();
  });

  it('keeps every revision content field optional, unlike published Extension content', () => {
    expectTypeOf<
      undefined extends ExtensionRevision['content']['name'] ? true : false
    >().toEqualTypeOf<true>();
    expectTypeOf<
      undefined extends ExtensionRevision['content']['readme'] ? true : false
    >().toEqualTypeOf<true>();
    expectTypeOf<
      undefined extends Extension['name'] ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      undefined extends Extension['readme'] ? true : false
    >().toEqualTypeOf<false>();
  });

  it('keeps façade pagination and payload types tied to generated responses', () => {
    expectTypeOf<ModerationQueuePage['pagination']>().toEqualTypeOf<{
      next_cursor: string | null;
      has_more: boolean;
    }>();
    expectTypeOf<
      ReturnType<ReturnType<typeof createApiClient>['listModerationQueue']>
    >().resolves.toEqualTypeOf<ModerationQueuePage>();
  });
});

describe('application boundary validation', () => {
  it('validates only the fields used by catalogue cards', () => {
    expect(
      isCatalogueCardPage({
        result: [
          {
            id: 'card-only',
            name: 'Card only',
            description: 'Card fields are sufficient.',
            version: '1.0.0',
          },
        ],
        pagination: { next_cursor: null, has_more: false },
      }),
    ).toBe(true);

    expect(
      isCatalogueCardPage({
        result: [
          {
            id: 'invalid-card',
            name: 123,
            description: 'Invalid name.',
            version: '1.0.0',
          },
        ],
        pagination: { next_cursor: null, has_more: false },
      }),
    ).toBe(false);

    expect(
      isCatalogueCardPage({
        result: [],
        pagination: { next_cursor: '', has_more: true },
      }),
    ).toBe(false);
  });

  it('keeps runtime filter validation independent from generated DTO imports', () => {
    expect(isExtensionType('mod')).toBe(true);
    expect(isExtensionType('not-a-type')).toBe(false);
    expect(isSourceType('github')).toBe(true);
    expect(isSourceType('not-a-source')).toBe(false);
    expect(isDeveloperType('organization')).toBe(true);
    expect(isDeveloperType('not-a-developer')).toBe(false);
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

  it('deduplicates already-rendered DOM IDs without constructing fake DTOs', async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValue(page([item('ALPHA'), item('second')], null, false));
    const pager = createCataloguePagerFromIds(
      ['alpha'],
      { next_cursor: 'cursor-2', has_more: true },
      filters,
      loadPage,
    );

    const state = await pager.loadNextPage();

    expect(state.items.map((extension) => extension.id)).toEqual(['second']);
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

  it('does not offer a next page when the cursor is empty', () => {
    const pageWithEmptyCursor = page([item('only')], '', true);

    expect(stateFromPage(pageWithEmptyCursor).hasMore).toBe(false);
    expect(
      appendPage(
        stateFromPage(page([item('first')], 'cursor-2', true)),
        pageWithEmptyCursor,
      ).hasMore,
    ).toBe(false);
  });

  it('retains loaded results and does not reset or retry after an invalid cursor', async () => {
    const invalidCursor = new ApiRequestError(
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

describe('server-rendered cursor links', () => {
  it('preserves active filters and passes the opaque cursor unchanged', () => {
    expect(
      cursorPageUrl(
        new URL(
          'https://example.test/account/moderate?status=approved&view=queue',
        ),
        'cursor',
        'cursors',
        'cursor/with?opaque=characters',
      ),
    ).toBe(
      '/account/moderate?status=approved&view=queue&cursor=cursor%2Fwith%3Fopaque%3Dcharacters',
    );
  });

  it('pushes the current cursor onto the back-stack when moving forward', () => {
    expect(
      cursorPageUrl(
        new URL('https://example.test/account/moderate?cursor=page-2'),
        'cursor',
        'cursors',
        'page-3',
      ),
    ).toBe('/account/moderate?cursor=page-3&cursors=page-2');

    expect(
      cursorPageUrl(
        new URL(
          'https://example.test/account/moderate?cursor=page-2&cursors=page-1',
        ),
        'cursor',
        'cursors',
        'page-3',
      ),
    ).toBe('/account/moderate?cursor=page-3&cursors=page-1%2Cpage-2');
  });

  it('pops the back-stack to build the previous page, or null on the first page', () => {
    expect(
      prevCursorPageUrl(
        new URL('https://example.test/account/moderate'),
        'cursor',
        'cursors',
      ),
    ).toBeNull();

    expect(
      prevCursorPageUrl(
        new URL(
          'https://example.test/account/moderate?cursor=page-3&cursors=page-1%2Cpage-2',
        ),
        'cursor',
        'cursors',
      ),
    ).toBe('/account/moderate?cursor=page-2&cursors=page-1');

    // Popping the last stacked cursor returns to the first page: no cursor
    // param at all, not an empty one.
    expect(
      prevCursorPageUrl(
        new URL('https://example.test/account/moderate?cursor=page-2'),
        'cursor',
        'cursors',
      ),
    ).toBe('/account/moderate');
  });

  it('drops the cursor and its back-stack when a filter changes', () => {
    expect(
      filterPageUrl(
        new URL(
          'https://example.test/account/moderate?extStatus=published&extCursor=page-2&extCursors=page-1',
        ),
        'extStatus',
        'delisted',
        ['extCursor', 'extCursors'],
      ),
    ).toBe('/account/moderate?extStatus=delisted');

    expect(
      filterPageUrl(
        new URL(
          'https://example.test/account/moderate?extStatus=delisted&extCursor=page-2',
        ),
        'extStatus',
        null,
        ['extCursor', 'extCursors'],
      ),
    ).toBe('/account/moderate');
  });
});
