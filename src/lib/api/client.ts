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
  getExtensionsByIdRevisions,
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
  type GetExtensionsByIdRevisionsData,
  type GetExtensionsByIdRevisionsResponse,
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

export const DEFAULT_API_PAGE_LIMIT = 50;
export const MIN_API_PAGE_LIMIT = 1;
export const MAX_API_PAGE_LIMIT = 100;

type ExtensionListQuery = NonNullable<GetExtensionsData['query']>;
type RevisionHistoryQuery = NonNullable<
  GetExtensionsByIdRevisionsData['query']
>;
type RevisionQueueQuery = NonNullable<GetRevisionsData['query']>;

export type ExtensionCatalogueFilters = Pick<
  ExtensionListQuery,
  'type' | 'developer_id' | 'limit' | 'cursor'
>;

export type ExtensionMineFilters = Pick<
  ExtensionListQuery,
  'type' | 'limit' | 'cursor'
>;

export type RevisionHistoryOptions = Pick<
  RevisionHistoryQuery,
  'cursor' | 'limit'
>;

export type ModerationQueueOptions = Pick<
  RevisionQueueQuery,
  'cursor' | 'limit'
>;

export type ModerationExtensionFilters = Pick<
  ExtensionListQuery,
  'status' | 'type' | 'q' | 'limit' | 'cursor'
>;

export type ModerationExtensionStatus = Exclude<
  ExtensionListQuery['status'],
  undefined
>;

export type RevisionHistoryPage = GetExtensionsByIdRevisionsResponse;
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
export type IdentitySyncInput = UserIdentityInput;
export type OwnedDeveloper = OwnedDeveloperProfile;

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

export function clampApiPageLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_API_PAGE_LIMIT;
  }

  return Math.min(
    MAX_API_PAGE_LIMIT,
    Math.max(MIN_API_PAGE_LIMIT, Math.trunc(limit)),
  );
}

export const clampExtensionPageLimit = clampApiPageLimit;

// The offset-paginated moderator lists (developers, claims, history) cap a
// single request at 100 rows and apply exactly that window when no params
// are sent. The admin surfaces consume whole lists (tab counts, server-side
// substring search), so the wrappers walk every page and concatenate.
const MODERATOR_LIST_PAGE_LIMIT = 100;

async function fetchWholeList<T>(
  fetchPage: (
    offset: number,
    limit: number,
  ) => Promise<{
    items: T[];
    hasMore: boolean;
  }>,
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  for (;;) {
    const result = await fetchPage(offset, MODERATOR_LIST_PAGE_LIMIT);
    items.push(...result.items);
    if (!result.hasMore) {
      return items;
    }
    // Termination is the API reporting has_more=false. The only runaway a
    // client can detect is a page claiming more data but returning no rows:
    // without this guard that loop never ends. Advancing by the rows
    // actually received (not the requested limit) keeps the walk correct
    // even if the server clamps the window.
    if (result.items.length === 0) {
      throw new Error(
        'The API reported more pages but returned no rows for this one.',
      );
    }
    offset += result.items.length;
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

function pageQuery(
  options: RevisionHistoryOptions | ModerationQueueOptions = {},
): { limit: number; cursor?: string } {
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

function extensionQuery(
  filters: ExtensionCatalogueFilters = {},
): ExtensionListQuery {
  const query: ExtensionListQuery = {
    limit: clampApiPageLimit(filters.limit),
  };

  if (filters.type !== undefined) {
    query.type = filters.type;
  }
  if (filters.developer_id !== undefined) {
    query.developer_id = filters.developer_id;
  }
  if (filters.cursor !== undefined) {
    query.cursor = filters.cursor;
  }

  return query;
}

function mineExtensionQuery(
  filters: ExtensionMineFilters = {},
): ExtensionListQuery {
  const query: ExtensionListQuery = {
    scope: 'mine',
    limit: clampApiPageLimit(filters.limit),
  };

  if (filters.type !== undefined) {
    query.type = filters.type;
  }
  if (filters.cursor !== undefined) {
    query.cursor = filters.cursor;
  }

  return query;
}

function moderationExtensionQuery(
  filters: ModerationExtensionFilters = {},
): ExtensionListQuery {
  const query: ExtensionListQuery = {
    scope: 'all',
    limit: clampApiPageLimit(filters.limit),
  };

  if (filters.status !== undefined) {
    query.status = filters.status;
  }
  if (filters.type !== undefined) {
    query.type = filters.type;
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
  const query = extensionQuery(filters);
  return cachedEdgeRead(
    dataCacheKey('extensions', {
      cursor: query.cursor,
      developer_id: query.developer_id,
      limit: query.limit,
      type: query.type,
    }),
    async () => {
      const page = await unwrap(
        await getExtensions({
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
    async () => {
      const response = await getExtensionsById({
        client: createApiTransport(env),
        path: { id },
      });
      const data = await unwrap(response);
      return data.result as Extension;
    },
  );
}

export async function getDeveloperById(
  env: ApplicationEnv,
  id: string,
): Promise<PublicDeveloper> {
  return cachedEdgeRead(
    dataCacheKey(`developer/${encodeURIComponent(id)}`),
    async () => {
      const response = await getDevelopersById({
        client: createApiTransport(env),
        path: { id },
      });
      const data = await unwrap(response);
      return data.result as PublicDeveloper;
    },
  );
}

export function createApiClient(env: ApplicationEnv, subject: string) {
  const client = createApiTransport(env, subject);

  return {
    syncIdentity: async (identity: IdentitySyncInput): Promise<AccountUser> =>
      (await unwrap(await putUsersMeIdentity({ client, body: identity })))
        .result,

    getUser: async (): Promise<AccountUser> =>
      (await unwrap(await getUsersMe({ client }))).result,

    updateUserProfile: async (displayName: string | null) =>
      (
        await unwrap(
          await patchUsersMe({
            client,
            body: { display_name: displayName },
          }),
        )
      ).result,

    deleteUser: async () =>
      (await unwrap(await deleteUsersMe({ client }))).result,

    getOwnDeveloper: async (): Promise<OwnedDeveloper | null> =>
      (await unwrap(await getDevelopersMe({ client }))).result,

    listMyExtensions: async (
      options: ExtensionMineFilters = {},
    ): Promise<OwnedExtensionListResponse> => {
      const page = await unwrap(
        await getExtensions({
          client,
          query: mineExtensionQuery(options),
        }),
      );
      return {
        result: page.result as OwnedExtensionListItem[],
        pagination: page.pagination,
      };
    },

    getMyExtension: async (id: string): Promise<OwnedExtension> =>
      requireOwnedExtension(
        (
          await unwrap(
            await getExtensionsById({
              client,
              path: { id },
            }),
          )
        ).result,
        id,
      ),

    createExtension: async (payload: ExtensionCreate) =>
      (
        await unwrap(
          await postExtensions({
            client,
            body: payload,
          }),
        )
      ).result,

    updateExtension: async (id: string, payload: ExtensionUpdate) =>
      (
        await unwrap(
          await putExtensionsById({
            client,
            path: { id },
            body: payload,
          }),
        )
      ).result,

    withdrawExtension: async (id: string) =>
      (
        await unwrap(
          await deleteExtensionsById({
            client,
            path: { id },
          }),
        )
      ).result,

    listExtensionRevisions: async (
      id: string,
      options: RevisionHistoryOptions = {},
    ): Promise<RevisionHistoryPage> =>
      unwrap(
        await getExtensionsByIdRevisions({
          client,
          path: { id },
          query: pageQuery(options),
        }),
      ),

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
    getModerationCounts: async (): Promise<ModerationCounts> =>
      (await unwrap(await getModerationCounts({ client }))).result,

    getModerationExtension: async (id: string): Promise<OwnedExtension> =>
      requireOwnedExtension(
        (
          await unwrap(
            await getExtensionsById({
              client,
              path: { id },
            }),
          )
        ).result,
        id,
      ),

    listAllExtensions: async (
      options: ModerationExtensionFilters = {},
    ): Promise<OwnedExtensionListResponse> => {
      const page = await unwrap(
        await getExtensions({
          client,
          query: moderationExtensionQuery(options),
        }),
      );
      return {
        result: page.result as OwnedExtensionListItem[],
        pagination: page.pagination,
      };
    },

    approveRevision: async (
      extensionId: string,
      revisionId: string,
      reviewNote?: string,
      notify = true,
    ) =>
      (
        await unwrap(
          await postExtensionsByIdRevisionsByRevisionIdApprove({
            client,
            path: { id: extensionId, revisionId },
            ...notifyQuery(notify),
            ...(reviewNote ? { body: { review_note: reviewNote } } : {}),
          }),
        )
      ).result,

    rejectRevision: async (
      extensionId: string,
      revisionId: string,
      reviewNote: string,
      notify = true,
    ) =>
      (
        await unwrap(
          await postExtensionsByIdRevisionsByRevisionIdReject({
            client,
            path: { id: extensionId, revisionId },
            ...notifyQuery(notify),
            body: { review_note: reviewNote },
          }),
        )
      ).result,

    delistExtension: async (
      extensionId: string,
      reason: string,
      notify = true,
    ) =>
      (
        await unwrap(
          await postExtensionsByIdDelist({
            client,
            path: { id: extensionId },
            ...notifyQuery(notify),
            body: { reason },
          }),
        )
      ).result,

    upsertDeveloperProfile: async (developer: Developer) =>
      (
        await unwrap(
          await putDevelopersMe({
            client,
            body: developer,
          }),
        )
      ).result,

    deleteDeveloperProfile: async () =>
      (
        await unwrap(
          await deleteDevelopersMe({
            client,
          }),
        )
      ).result,

    reverifyDeveloper: async (checkUrl = false) =>
      (
        await unwrap(
          await postDevelopersMeReverify({
            client,
            ...(checkUrl ? { query: { check_url: 'true' } } : {}),
          }),
        )
      ).result,

    listUnapprovedDevelopers: async () =>
      fetchWholeList<DeveloperProfile>(async (offset, limit) => {
        const page = await unwrap(
          await getDevelopers({
            client,
            query: { status: 'unapproved', limit, offset },
          }),
        );
        return { items: page.result, hasMore: page.pagination.has_more };
      }),

    listAllDevelopers: async () =>
      fetchWholeList<DeveloperProfile>(async (offset, limit) => {
        const page = await unwrap(
          await getDevelopers({
            client,
            query: { status: 'all', limit, offset },
          }),
        );
        return { items: page.result, hasMore: page.pagination.has_more };
      }),

    approveDeveloper: async (
      id: string,
      expectedRevision: number,
      notify = true,
    ) =>
      (
        await unwrap(
          await postDevelopersByIdApprove({
            client,
            path: { id },
            ...notifyQuery(notify),
            body: {
              expected_revision: expectedRevision,
            } satisfies DeveloperApproval,
          }),
        )
      ).result,

    listDeveloperHistory: async (id: string) =>
      fetchWholeList<DeveloperHistoryEntry>(async (offset, limit) => {
        const page = await unwrap(
          await getDevelopersByIdHistory({
            client,
            path: { id },
            query: { limit, offset },
          }),
        );
        return { items: page.result, hasMore: page.pagination.has_more };
      }),

    initiateTransfer: async (id: string) =>
      (
        await unwrap(
          await postDevelopersByIdTransfer({
            client,
            path: { id },
          }),
        )
      ).result,

    revokeTransfer: async (id: string) =>
      (
        await unwrap(
          await postDevelopersByIdTransferRevoke({
            client,
            path: { id },
          }),
        )
      ).result,

    acceptTransfer: async (token: string) =>
      (
        await unwrap(
          await postDevelopersTransfersAccept({
            client,
            body: { token },
          }),
        )
      ).result,

    claimDeveloper: async (id: string, note?: string) =>
      (
        await unwrap(
          await postDevelopersByIdClaim({
            client,
            path: { id },
            ...(note ? { body: { note } } : {}),
          }),
        )
      ).result,

    cancelClaim: async (id: string) =>
      (
        await unwrap(
          await postDevelopersClaimsByIdCancel({
            client,
            path: { id },
          }),
        )
      ).result,

    listMyClaims: async () =>
      fetchWholeList<PendingDeveloperClaim>(async (offset, limit) => {
        const page = await unwrap(
          await getDevelopersClaims({
            client,
            query: { scope: 'mine', limit, offset },
          }),
        );
        return { items: page.result, hasMore: page.pagination.has_more };
      }),

    listPendingClaims: async () =>
      fetchWholeList<PendingDeveloperClaim>(async (offset, limit) => {
        const page = await unwrap(
          await getDevelopersClaims({
            client,
            query: { scope: 'pending', limit, offset },
          }),
        );
        return { items: page.result, hasMore: page.pagination.has_more };
      }),

    approveClaim: async (id: string, notify = true) =>
      (
        await unwrap(
          await postDevelopersClaimsByIdApprove({
            client,
            path: { id },
            ...notifyQuery(notify),
          }),
        )
      ).result,

    rejectClaim: async (id: string, reviewNote: string, notify = true) =>
      (
        await unwrap(
          await postDevelopersClaimsByIdReject({
            client,
            path: { id },
            ...notifyQuery(notify),
            body: { review_note: reviewNote },
          }),
        )
      ).result,
  };
}
