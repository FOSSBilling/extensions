import {
  deleteDevelopersMe,
  deleteExtensionsById,
  getDevelopers,
  getDevelopersById,
  getDevelopersByIdHistory,
  getDevelopersClaims,
  getDevelopersMe,
  getExtensions,
  getExtensionsById,
  getModerationCounts,
  getRevisions,
  getUsersMe,
  patchUsersMe,
  postDevelopersByIdApprove,
  postDevelopersByIdClaim,
  postDevelopersByIdTransfer,
  postDevelopersByIdTransferRevoke,
  postDevelopersClaimsByIdApprove,
  postDevelopersClaimsByIdCancel,
  postDevelopersClaimsByIdReject,
  postDevelopersMeReverify,
  postDevelopersTransfersAccept,
  postExtensions,
  postExtensionsByIdDelist,
  postExtensionsByIdModeratorCorrect,
  postExtensionsByIdRevisionsByRevisionIdApprove,
  postExtensionsByIdRevisionsByRevisionIdReject,
  deleteUsersMe,
  putDevelopersMe,
  putExtensionsById,
  putUsersMeIdentity,
  type Developer,
  type DeveloperApproval,
  type DeveloperHistoryEntry,
  type DeveloperProfile,
  type DeveloperTransfer,
  type Error as ApiErrorBody,
  type Extension,
  type ExtensionCreate,
  type ExtensionListItem,
  type ExtensionRevision,
  type ExtensionUpdate,
  type GetExtensionsData,
  type GetModerationCountsResponse,
  type GetRevisionsData,
  type GetRevisionsResponses,
  type OwnedDeveloperProfile,
  type OwnedExtension,
  type OwnedExtensionListItem,
  type Pagination,
  type PendingDeveloperClaim,
  type PublicDeveloper,
  type User,
  type UserIdentityInput,
  type PutDevelopersMeData,
} from '@/lib/api/generated/extensions-v2';
import {
  createClient,
  type Client,
} from '@/lib/api/generated/extensions-v2/client';
import { dataCacheKey, cachedEdgeRead } from '../cache';
import { mintBearerAssertion } from '../assertion';
import type { ApplicationEnv } from '../runtime';

const DEFAULT_API_PAGE_LIMIT = 50;
const MIN_API_PAGE_LIMIT = 1;
const MAX_API_PAGE_LIMIT = 100;

type ExtensionListQuery = NonNullable<GetExtensionsData['query']>;
type RevisionQueueQuery = NonNullable<GetRevisionsData['query']>;
type ListFilters = Pick<
  ExtensionListQuery,
  'type' | 'developer_id' | 'status' | 'q' | 'limit' | 'cursor'
>;

export type ExtensionCatalogueFilters = Pick<
  ExtensionListQuery,
  'type' | 'developer_id' | 'limit' | 'cursor'
>;

type ExtensionMineFilters = Pick<ListFilters, 'type' | 'limit' | 'cursor'>;

type ModerationQueueOptions = Pick<RevisionQueueQuery, 'cursor' | 'limit'>;

type ModerationExtensionFilters = Pick<
  ListFilters,
  'status' | 'type' | 'q' | 'limit' | 'cursor'
>;

export type ModerationExtensionStatus = Exclude<
  ExtensionListQuery['status'],
  undefined
>;

export type ModerationQueuePage = GetRevisionsResponses[200];
export type DeveloperProfileInput = NonNullable<PutDevelopersMeData['body']>;
export type RevisionStatus = Exclude<RevisionQueueQuery['status'], undefined>;
export type ModerationCounts = GetModerationCountsResponse['result'];

// The v2 list/detail reads are role-aware unions. These wrappers pin a scope
// (public catalogue vs mine/all) or a transport (anonymous vs authenticated),
// so they narrow to the projection that scope always returns.
export interface ExtensionListResponse {
  result: ExtensionListItem[];
  pagination: Pagination;
}

export interface OwnedExtensionListResponse {
  result: OwnedExtensionListItem[];
  pagination: Pagination;
}

export type AccountUser = User;

export type {
  Developer,
  DeveloperApproval,
  DeveloperHistoryEntry,
  DeveloperProfile,
  DeveloperTransfer,
  Extension,
  ExtensionCreate,
  ExtensionListItem,
  ExtensionRevision,
  ExtensionUpdate,
  OwnedExtension,
  OwnedExtensionListItem,
  PendingDeveloperClaim,
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown[];

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown[],
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getApiErrorMessage(error: ApiRequestError): string {
  switch (error.code) {
    case 'RATE_LIMITED':
      return 'Too many requests were made. Please wait a few minutes and try again.';
    case 'SERVICE_UNAVAILABLE':
      return 'The service is temporarily unavailable. Please try again manually in a few minutes.';
    default:
      return error.message;
  }
}

// Shapes the JSON API routes' error responses: ApiRequestErrors keep their
// upstream code/message/details (with a 4xx/5xx status floor), and anything
// else falls back to a generic request_failed 502.
export function apiErrorResponse(
  error: unknown,
  fallbackMessage: string,
): Response {
  if (error instanceof ApiRequestError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.status >= 400 ? error.status : 502 },
    );
  }

  return Response.json(
    { error: { code: 'request_failed', message: fallbackMessage } },
    { status: 502 },
  );
}

export function clampApiPageLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_API_PAGE_LIMIT;
  }

  return Math.min(
    MAX_API_PAGE_LIMIT,
    Math.max(MIN_API_PAGE_LIMIT, Math.trunc(limit)),
  );
}

// Cursor-paginated list endpoints cap a single request at 100 rows. Some
// surfaces consume whole lists (admin tab counts, server-side substring
// search, an owner's full set of extensions), so the walks fetch every page
// with the opaque cursor and concatenate.
const MODERATOR_LIST_PAGE_LIMIT = 100;

export async function paginateAll<T>(
  fetchPage: (
    cursor: string | undefined,
    limit: number,
  ) => Promise<{ result: T[]; pagination: Pagination }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor, MODERATOR_LIST_PAGE_LIMIT);
    items.push(...page.result);
    if (!page.pagination.has_more) {
      return items;
    }
    // Termination is the API reporting has_more=false. Two runaways are
    // client-detectable and must end the loop: a page claiming more data
    // but returning no rows or no cursor, and a page handing back the same
    // cursor it was just called with (the same page would be appended
    // forever).
    if (page.result.length === 0 || !page.pagination.next_cursor) {
      throw new Error(
        'The API reported more pages but returned no rows or cursor for this one.',
      );
    }
    if (page.pagination.next_cursor === cursor) {
      throw new Error(
        'The API returned the same cursor twice, so walking it would never end.',
      );
    }
    cursor = page.pagination.next_cursor;
  }
}

function createApiTransport(env: ApplicationEnv, subject?: string): Client {
  const baseUrl = env.extensionsApi.baseUrl.replace(/\/$/, '');

  return createClient({
    baseUrl: `${baseUrl}/extensions/v2`,
    fetch: env.extensionsApi.fetch,
    ...(subject
      ? {
          auth: () => mintBearerAssertion(subject, env.assertionSigningSecret),
        }
      : {}),
  });
}

function isStructuredApiError(error: unknown): error is ApiErrorBody {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const nested = (error as { error?: unknown }).error;
  return (
    nested !== null &&
    typeof nested === 'object' &&
    typeof (nested as { code?: unknown }).code === 'string' &&
    typeof (nested as { message?: unknown }).message === 'string' &&
    (typeof (nested as { details?: unknown }).details === 'undefined' ||
      Array.isArray((nested as { details?: unknown }).details))
  );
}

function apiErrorFrom(
  error: unknown,
  status: number | undefined,
): ApiRequestError {
  if (isStructuredApiError(error)) {
    return new ApiRequestError(
      status ?? 502,
      error.error.code,
      error.error.message,
      error.error.details,
    );
  }

  return new ApiRequestError(
    status ?? 502,
    'request_failed',
    error instanceof Error
      ? error.message
      : 'The extensions API request failed.',
  );
}

async function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response?: Response;
}): Promise<T> {
  if (result.data !== undefined) {
    return result.data;
  }

  throw apiErrorFrom(result.error, result.response?.status);
}

// Standard facade call: perform an SDK request, normalize its errors, and
// return the body's `result` field.
async function callResult<T>(
  request: Promise<{
    data?: { result: T };
    error?: unknown;
    response?: Response;
  }>,
): Promise<T> {
  return (await unwrap(await request)).result;
}

// Like callResult, but keeps the pagination envelope that list reads return
// alongside their rows.
async function callPage<T>(
  request: Promise<{
    data?: { result: T[]; pagination: Pagination };
    error?: unknown;
    response?: Response;
  }>,
): Promise<{ result: T[]; pagination: Pagination }> {
  const page = await unwrap(await request);
  return { result: page.result, pagination: page.pagination };
}

function pageQuery(options: ModerationQueueOptions = {}): {
  limit: number;
  cursor?: string;
} {
  const query: { limit: number; cursor?: string } = {
    limit: clampApiPageLimit(options.limit),
  };

  if (options.cursor !== undefined) {
    query.cursor = options.cursor;
  }

  return query;
}

// Moderation writes email the author unless the moderator opts out. The API
// defaults to sending, so only the opt-out travels as ?notify=false.
function notifyQuery(notify: boolean): { query?: { notify: 'false' } } {
  return notify ? {} : { query: { notify: 'false' } };
}

function requireOwnedExtension(
  result: Extension | OwnedExtension,
  id: string,
): OwnedExtension {
  // The role-aware detail read falls through to the public projection for
  // unrelated callers instead of 403ing. Owner/moderator views must not
  // mistake that for an owned row, so treat it as not-found like before.
  if (!('pending_revision' in result)) {
    throw new ApiRequestError(404, 'not_found', `Extension "${id}" not found.`);
  }

  return result;
}

// Builds the query for the role-aware extension list reads. `scope` selects
// the projection (undefined = public catalogue); callers pass only the
// filters their surface uses.
function listQuery(
  scope: 'mine' | 'all' | undefined,
  filters: ListFilters = {},
): ExtensionListQuery {
  const query: ExtensionListQuery = {
    limit: clampApiPageLimit(filters.limit),
    ...(scope ? { scope } : {}),
  };

  if (filters.type !== undefined) {
    query.type = filters.type;
  }
  if (filters.developer_id !== undefined) {
    query.developer_id = filters.developer_id;
  }
  if (filters.status !== undefined) {
    query.status = filters.status;
  }
  if (filters.q !== undefined) {
    query.q = filters.q;
  }
  if (filters.cursor !== undefined) {
    query.cursor = filters.cursor;
  }

  return query;
}

// The three anonymous catalogue reads below are edge-cached: their results
// only change when a moderator approves a revision, so a short TTL absorbs
// most repeat traffic without any invalidation protocol. Authenticated
// reads (scope=mine/all) must never pass through this cache.
export async function listExtensions(
  env: ApplicationEnv,
  filters: ExtensionCatalogueFilters = {},
): Promise<ExtensionListResponse> {
  const query = listQuery(undefined, filters);
  return cachedEdgeRead(
    dataCacheKey('extensions', {
      cursor: query.cursor,
      developer_id: query.developer_id,
      limit: query.limit,
      type: query.type,
    }),
    async () => {
      const page = await callPage(
        getExtensions({
          client: createApiTransport(env),
          query,
        }),
      );
      return {
        result: page.result as ExtensionListItem[],
        pagination: page.pagination,
      };
    },
  );
}

export async function getExtensionById(
  env: ApplicationEnv,
  id: string,
): Promise<Extension> {
  return cachedEdgeRead(
    dataCacheKey(`extension/${encodeURIComponent(id)}`),
    async () =>
      (await callResult(
        getExtensionsById({
          client: createApiTransport(env),
          path: { id },
        }),
      )) as Extension,
  );
}

export async function getDeveloperById(
  env: ApplicationEnv,
  id: string,
): Promise<PublicDeveloper> {
  return cachedEdgeRead(
    dataCacheKey(`developer/${encodeURIComponent(id)}`),
    async () =>
      (await callResult(
        getDevelopersById({
          client: createApiTransport(env),
          path: { id },
        }),
      )) as PublicDeveloper,
  );
}

export function createApiClient(env: ApplicationEnv, subject: string) {
  const client = createApiTransport(env, subject);

  // The unapproved/all developer and mine/pending claim walks are the same
  // whole-list fetch at a different scope literal.
  const developersByScope = (scope: 'all' | 'unapproved') =>
    paginateAll<DeveloperProfile>((cursor, limit) =>
      callPage(
        getDevelopers({
          client,
          query: { scope, limit, ...(cursor ? { cursor } : {}) },
        }),
      ),
    );

  const claimsByScope = (scope: 'mine' | 'pending') =>
    paginateAll<PendingDeveloperClaim>((cursor, limit) =>
      callPage(
        getDevelopersClaims({
          client,
          query: { scope, limit, ...(cursor ? { cursor } : {}) },
        }),
      ),
    );

  return {
    syncIdentity: (identity: UserIdentityInput): Promise<AccountUser> =>
      callResult(putUsersMeIdentity({ client, body: identity })),

    getUser: (): Promise<AccountUser> => callResult(getUsersMe({ client })),

    updateUserProfile: (displayName: string | null) =>
      callResult(patchUsersMe({ client, body: { display_name: displayName } })),

    deleteUser: () => callResult(deleteUsersMe({ client })),

    getOwnDeveloper: (): Promise<OwnedDeveloperProfile | null> =>
      callResult(getDevelopersMe({ client })),

    listMyExtensions: async (
      options: ExtensionMineFilters = {},
    ): Promise<OwnedExtensionListResponse> => {
      const page = await callPage(
        getExtensions({ client, query: listQuery('mine', options) }),
      );
      return {
        result: page.result as OwnedExtensionListItem[],
        pagination: page.pagination,
      };
    },

    getMyExtension: async (id: string): Promise<OwnedExtension> =>
      requireOwnedExtension(
        await callResult(getExtensionsById({ client, path: { id } })),
        id,
      ),

    createExtension: (payload: ExtensionCreate) =>
      callResult(postExtensions({ client, body: payload })),

    updateExtension: (id: string, payload: ExtensionUpdate) =>
      callResult(putExtensionsById({ client, path: { id }, body: payload })),

    withdrawExtension: (id: string) =>
      callResult(deleteExtensionsById({ client, path: { id } })),

    listModerationQueue: async (
      status: RevisionStatus = 'pending',
      options: ModerationQueueOptions = {},
    ): Promise<ModerationQueuePage> =>
      unwrap(
        await getRevisions({
          client,
          query: { status, ...pageQuery(options) },
        }),
      ),

    // Queue totals behind the admin tabs. Best-effort by design: pages
    // render plain tab labels when it fails rather than erroring the
    // whole queue.
    getModerationCounts: (): Promise<ModerationCounts> =>
      callResult(getModerationCounts({ client })),

    getModerationExtension: async (id: string): Promise<OwnedExtension> =>
      requireOwnedExtension(
        await callResult(getExtensionsById({ client, path: { id } })),
        id,
      ),

    listAllExtensions: async (
      options: ModerationExtensionFilters = {},
    ): Promise<OwnedExtensionListResponse> => {
      const page = await callPage(
        getExtensions({ client, query: listQuery('all', options) }),
      );
      return {
        result: page.result as OwnedExtensionListItem[],
        pagination: page.pagination,
      };
    },

    approveRevision: (
      extensionId: string,
      revisionId: string,
      reviewNote?: string,
      notify = true,
    ) =>
      callResult(
        postExtensionsByIdRevisionsByRevisionIdApprove({
          client,
          path: { id: extensionId, revisionId },
          ...notifyQuery(notify),
          ...(reviewNote ? { body: { review_note: reviewNote } } : {}),
        }),
      ),

    rejectRevision: (
      extensionId: string,
      revisionId: string,
      reviewNote: string,
      notify = true,
    ) =>
      callResult(
        postExtensionsByIdRevisionsByRevisionIdReject({
          client,
          path: { id: extensionId, revisionId },
          ...notifyQuery(notify),
          body: { review_note: reviewNote },
        }),
      ),

    delistExtension: (extensionId: string, reason: string, notify = true) =>
      callResult(
        postExtensionsByIdDelist({
          client,
          path: { id: extensionId },
          ...notifyQuery(notify),
          body: { reason },
        }),
      ),

    // Moderator correction of live content (api#251): unlike every other
    // moderation write there is no notify option and no author email — the
    // correction is recorded as an approved moderator revision and surfaced
    // in history by the directory UI.
    correctExtension: (
      extensionId: string,
      payload: ExtensionUpdate,
      correctionNote: string,
    ) =>
      callResult(
        postExtensionsByIdModeratorCorrect({
          client,
          path: { id: extensionId },
          body: { ...payload, correction_note: correctionNote },
        }),
      ),

    upsertDeveloperProfile: (developer: Developer) =>
      callResult(putDevelopersMe({ client, body: developer })),

    deleteDeveloperProfile: () => callResult(deleteDevelopersMe({ client })),

    reverifyDeveloper: (checkUrl = false) =>
      callResult(
        postDevelopersMeReverify({
          client,
          ...(checkUrl ? { query: { check_url: 'true' } } : {}),
        }),
      ),

    listUnapprovedDevelopers: () => developersByScope('unapproved'),

    listAllDevelopers: () => developersByScope('all'),

    approveDeveloper: (id: string, expectedRevision: number, notify = true) =>
      callResult(
        postDevelopersByIdApprove({
          client,
          path: { id },
          ...notifyQuery(notify),
          body: {
            expected_revision: expectedRevision,
          } satisfies DeveloperApproval,
        }),
      ),

    listDeveloperHistory: (id: string) =>
      paginateAll<DeveloperHistoryEntry>((cursor, limit) =>
        callPage(
          getDevelopersByIdHistory({
            client,
            path: { id },
            query: { limit, ...(cursor ? { cursor } : {}) },
          }),
        ),
      ),

    initiateTransfer: (id: string) =>
      callResult(postDevelopersByIdTransfer({ client, path: { id } })),

    revokeTransfer: (id: string) =>
      callResult(postDevelopersByIdTransferRevoke({ client, path: { id } })),

    acceptTransfer: (token: string) =>
      callResult(postDevelopersTransfersAccept({ client, body: { token } })),

    claimDeveloper: (id: string, note?: string) =>
      callResult(
        postDevelopersByIdClaim({
          client,
          path: { id },
          ...(note ? { body: { note } } : {}),
        }),
      ),

    cancelClaim: (id: string) =>
      callResult(postDevelopersClaimsByIdCancel({ client, path: { id } })),

    listMyClaims: () => claimsByScope('mine'),

    listPendingClaims: () => claimsByScope('pending'),

    approveClaim: (id: string, notify = true) =>
      callResult(
        postDevelopersClaimsByIdApprove({
          client,
          path: { id },
          ...notifyQuery(notify),
        }),
      ),

    rejectClaim: (id: string, reviewNote: string, notify = true) =>
      callResult(
        postDevelopersClaimsByIdReject({
          client,
          path: { id },
          ...notifyQuery(notify),
          body: { review_note: reviewNote },
        }),
      ),
  };
}
