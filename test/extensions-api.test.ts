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
  apiErrorResponse,
  clampApiPageLimit,
  createApiClient,
  getApiErrorMessage,
  getExtensionById,
  listExtensions,
  type Extension,
  type ExtensionCreate,
  type ExtensionListItem,
  type ExtensionListResponse,
  type ExtensionRevision,
  type ModerationQueuePage,
  type OwnedExtensionListResponse,
} from '@/lib/api/client';
import { mintBearerAssertion } from '@/lib/assertion';
import { makeEnv } from './helpers/env';
import { item, page } from './helpers/catalogue-fixtures';
import type {
  DeveloperHistoryEntry,
  DeveloperProfile,
  PendingDeveloperClaim,
} from '@/lib/api/generated/extensions-v2';
import type {
  DeveloperProfile as LocalDeveloperProfile,
  Extension as LocalExtension,
} from '@/types';

const publicEnv = makeEnv({
  assertionSigningSecret: '',
  revalidateSecret: '',
});

const authenticatedEnv = makeEnv({ assertionSigningSecret: 'test-secret' });

function apiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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
    expect(clampApiPageLimit(101)).toBe(100);
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
    expect(requestUrl(fetchMock, 0).pathname).toBe('/extensions/v2/extensions');
    expect(requestUrl(fetchMock, 0).searchParams.get('scope')).toBe('mine');
    expect(requestUrl(fetchMock, 0).searchParams.get('limit')).toBe('100');
    expect(requestUrl(fetchMock, 0).searchParams.get('cursor')).toBe(
      'opaque cursor',
    );
    expect(requestUrl(fetchMock, 1).searchParams.has('cursor')).toBe(false);
    // The mine scope never carries the public catalogue's developer_id
    // filter, and the owner listing sends no type filter.
    expect(requestUrl(fetchMock, 0).searchParams.has('developer_id')).toBe(
      false,
    );
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

  it('approves and rejects a revision by extension id + revision id', async () => {
    // Mirrors the approve route: the approve dialog posts no review note, so
    // the body must be absent — only rejections carry one.
    const approveFetch = vi
      .fn()
      .mockResolvedValue(
        apiResponse({ result: { id: 'r-1', status: 'approved' } }),
      );
    vi.stubGlobal('fetch', approveFetch);
    await createApiClient(authenticatedEnv, 'moderator-sub').approveRevision(
      'body-extension',
      'r-1',
      undefined,
      true,
    );
    const approveRequest = requestFrom(approveFetch);
    expect(new URL(approveRequest.url).pathname).toBe(
      '/extensions/v2/extensions/body-extension/revisions/r-1/approve',
    );
    expect(approveRequest.body).toBeNull();

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

  it('corrects live content as a moderator with no notify query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      apiResponse({
        result: { id: 'live-ext', revision_id: 'rev-1', status: 'approved' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const payload = {
      type: 'mod' as const,
      name: 'Fixed',
      description: 'd',
      releases: [],
      website: 'https://example.test',
      license: { name: 'MIT' },
      readme: '# Fixed',
      source: { type: 'github' as const, repo: 'example/live' },
      version: '1.0.0',
      download_url: 'https://example.test/live.zip',
    };

    const result = await createApiClient(
      authenticatedEnv,
      'moderator-sub',
    ).correctExtension('live-ext', payload, 'Fix truncated readme');

    const request = requestFrom(fetchMock);
    expect(requestUrl(fetchMock).pathname).toBe(
      '/extensions/v2/extensions/live-ext/moderator-correct',
    );
    expect(request.method).toBe('POST');
    // No notify opt-out travels: corrections never email the author (api#251).
    expect(requestUrl(fetchMock).searchParams.get('notify')).toBeNull();
    expect(await request.json()).toEqual({
      ...payload,
      correction_note: 'Fix truncated readme',
    });
    expect(result).toEqual({
      id: 'live-ext',
      revision_id: 'rev-1',
      status: 'approved',
    });
  });

  it('skips the author email on moderation writes when asked', async () => {
    const delistFetch = vi.fn().mockResolvedValue(
      apiResponse({
        result: { id: 'body-extension', status: 'delisted', notified: false },
      }),
    );
    vi.stubGlobal('fetch', delistFetch);
    const delisted = await createApiClient(
      authenticatedEnv,
      'moderator-sub',
    ).delistExtension('body-extension', 'gone', false);
    expect(delistFetch).toHaveBeenCalledOnce();
    expect(requestUrl(delistFetch).searchParams.get('notify')).toBe('false');
    expect(delisted).toEqual({
      id: 'body-extension',
      status: 'delisted',
      notified: false,
    });

    const approveFetch = vi.fn().mockResolvedValue(
      apiResponse({
        result: { id: 'dev-1', approved: true, notified: true },
      }),
    );
    vi.stubGlobal('fetch', approveFetch);
    await createApiClient(authenticatedEnv, 'moderator-sub').approveDeveloper(
      'dev-1',
      3,
    );
    expect(requestUrl(approveFetch).searchParams.get('notify')).toBeNull();

    const optOutFetch = vi.fn().mockResolvedValue(
      apiResponse({
        result: { id: 'dev-1', approved: true, notified: false },
      }),
    );
    vi.stubGlobal('fetch', optOutFetch);
    await createApiClient(authenticatedEnv, 'moderator-sub').approveDeveloper(
      'dev-1',
      3,
      false,
    );
    expect(requestUrl(optOutFetch).searchParams.get('notify')).toBe('false');
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
    expect(requestUrl(fetchMock).pathname).toBe('/extensions/v2/revisions');
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

describe('error presentation helpers', () => {
  it('maps transient codes to retry copy and passes other messages through', () => {
    expect(
      getApiErrorMessage(new ApiRequestError(429, 'RATE_LIMITED', 'upstream')),
    ).toBe(
      'Too many requests were made. Please wait a few minutes and try again.',
    );
    expect(
      getApiErrorMessage(
        new ApiRequestError(503, 'SERVICE_UNAVAILABLE', 'upstream'),
      ),
    ).toBe(
      'The service is temporarily unavailable. Please try again manually in a few minutes.',
    );
    expect(
      getApiErrorMessage(
        new ApiRequestError(422, 'INVALID_CURSOR', 'Cursor is invalid.'),
      ),
    ).toBe('Cursor is invalid.');
  });

  it('shapes API error responses with a status floor and a generic fallback', async () => {
    const structured = apiErrorResponse(
      new ApiRequestError(422, 'INVALID_CURSOR', 'Cursor is invalid.', [
        'expired',
      ]),
      'fallback message',
    );
    expect(structured.status).toBe(422);
    await expect(structured.json()).resolves.toEqual({
      error: {
        code: 'INVALID_CURSOR',
        message: 'Cursor is invalid.',
        details: ['expired'],
      },
    });

    // A status below 400 (transport dropped mid-error) is presented as 502,
    // never as success-shaped.
    const floored = apiErrorResponse(
      new ApiRequestError(0, 'weird', 'boom'),
      'fallback message',
    );
    expect(floored.status).toBe(502);

    const fallback = apiErrorResponse(
      new Error('network down'),
      'Unable to load extensions.',
    );
    expect(fallback.status).toBe(502);
    await expect(fallback.json()).resolves.toEqual({
      error: { code: 'request_failed', message: 'Unable to load extensions.' },
    });
  });
});

describe('cursor-paginated moderator lists', () => {
  // The API caps these lists at 100 rows per request, so the wrappers walk
  // keyset pages with the opaque cursor instead of assuming one whole-list
  // response.
  function developerProfile(id: string): DeveloperProfile {
    return {
      id,
      type: 'user',
      name: id,
      approved: true,
      content_revision: 1,
    };
  }

  function myClaim(id: string): PendingDeveloperClaim {
    return {
      id,
      developer_id: 'dev-1',
      claimant_id: 'user-1',
      status: 'pending',
      created_at: '2026-01-01T00:00:00Z',
      developer_name: 'Dev One',
      developer_type: 'user',
      claimant_name: null,
      claimant_github_login: null,
    };
  }

  it('walks every page of the developer list and concatenates the rows', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        apiResponse(page([developerProfile('a')], 'cursor-1', true)),
      )
      .mockResolvedValueOnce(
        apiResponse(page([developerProfile('b')], null, false)),
      );
    vi.stubGlobal('fetch', fetchMock);

    const api = createApiClient(authenticatedEnv, 'moderator-sub');
    const developers = await api.listAllDevelopers();

    expect(developers.map((d) => d.id)).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl(fetchMock, 0).searchParams.get('limit')).toBe('100');
    expect(requestUrl(fetchMock, 0).searchParams.get('cursor')).toBe(null);
    expect(requestUrl(fetchMock, 1).searchParams.get('limit')).toBe('100');
    // The second page carries the previous page's next_cursor.
    expect(requestUrl(fetchMock, 1).searchParams.get('cursor')).toBe(
      'cursor-1',
    );
  });

  it('stops after a single request when has_more is false', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        apiResponse(page([developerProfile('only')], null, false)),
      );
    vi.stubGlobal('fetch', fetchMock);

    const api = createApiClient(authenticatedEnv, 'moderator-sub');
    const developers = await api.listUnapprovedDevelopers();

    expect(developers.map((d) => d.id)).toEqual(['only']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestUrl(fetchMock).searchParams.get('scope')).toBe('unapproved');
  });

  it('walks the claims queue and profile history with explicit pages', async () => {
    const claim = myClaim('claim-1');
    const entry: DeveloperHistoryEntry = {
      developer_id: 'dev-1',
      type: 'user',
      name: 'Dev One',
      changed_by: 'user-1',
      changed_by_name: null,
      changed_at: '2026-01-01T00:00:00Z',
    };

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === 'string' ? input : (input as Request).url,
      );
      if (url.pathname.endsWith('/developers/claims')) {
        return Promise.resolve(apiResponse(page([claim], null, false)));
      }
      if (url.pathname.endsWith('/history')) {
        return Promise.resolve(apiResponse(page([entry], null, false)));
      }
      return Promise.reject(new Error(`unexpected path: ${url.pathname}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const api = createApiClient(authenticatedEnv, 'moderator-sub');
    const [claims, history] = await Promise.all([
      api.listPendingClaims(),
      api.listDeveloperHistory('dev-1'),
    ]);

    expect(claims.map((c) => c.id)).toEqual(['claim-1']);
    expect(history.map((h) => h.developer_id)).toEqual(['dev-1']);
    const urls = fetchMock.mock.calls.map(
      (call) => new URL((call[0] as Request).url),
    );
    const claimsUrl = urls.find((u) =>
      u.pathname.endsWith('/developers/claims'),
    );
    const historyUrl = urls.find((u) => u.pathname.endsWith('/history'));
    expect(claimsUrl?.searchParams.get('scope')).toBe('pending');
    expect(claimsUrl?.searchParams.get('limit')).toBe('100');
    expect(claimsUrl?.searchParams.get('cursor')).toBe(null);
    expect(historyUrl?.searchParams.get('limit')).toBe('100');
    expect(historyUrl?.searchParams.get('cursor')).toBe(null);
  });

  it('throws instead of looping forever on an empty page that claims more', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(apiResponse(page([], null, true))),
      );
    vi.stubGlobal('fetch', fetchMock);

    const api = createApiClient(authenticatedEnv, 'moderator-sub');
    await expect(api.listAllDevelopers()).rejects.toThrow(/returned no rows/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('walks every page of my own claims like the other lists', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        apiResponse(page([myClaim('older')], 'cursor-1', true)),
      )
      .mockResolvedValueOnce(
        apiResponse(page([myClaim('newer')], null, false)),
      );
    vi.stubGlobal('fetch', fetchMock);

    const api = createApiClient(authenticatedEnv, 'user-sub');
    const claims = await api.listMyClaims();

    expect(claims.map((c) => c.id)).toEqual(['older', 'newer']);
    expect(requestUrl(fetchMock, 0).searchParams.get('scope')).toBe('mine');
    expect(requestUrl(fetchMock, 1).searchParams.get('cursor')).toBe(
      'cursor-1',
    );
  });
});
