import {
  deleteDevelopersMe,
  deleteExtensionsById,
  getDevelopers,
  getDevelopersById,
  getDevelopersByIdHistory,
  getDevelopersClaims,
  getDevelopersClaimsMine,
  getDevelopersMe,
  getDevelopersUnapproved,
  getExtensions,
  getExtensionsById,
  getExtensionsByIdRevisions,
  getExtensionsMine,
  getExtensionsMineById,
  getModerationExtensions,
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
  type DeveloperClaim,
  type DeveloperHistoryEntry,
  type DeveloperProfile,
  type DeveloperTransfer,
  type Error as ApiErrorBody,
  type Extension,
  type ExtensionCreate,
  type ExtensionListItem,
  type ExtensionListResponse,
  type ExtensionRevision,
  type ExtensionUpdate,
  type GetExtensionsByIdRevisionsData,
  type GetExtensionsByIdRevisionsResponse,
  type GetExtensionsData,
  type GetExtensionsMineData,
  type GetModerationExtensionsData,
  type GetModerationExtensionsResponse,
  type OwnedDeveloperProfile,
  type OwnedExtension,
  type OwnedExtensionListItem,
  type OwnedExtensionListResponse,
  type PendingDeveloperClaim,
  type User,
  type UserIdentityInput,
  type PutDevelopersMeData,
} from '@/lib/api/generated/extensions-v2';
import {
  createClient,
  type Client,
} from '@/lib/api/generated/extensions-v2/client';
import { mintBearerAssertion } from '../assertion';
import type { ApplicationEnv } from '../runtime';

export const DEFAULT_API_PAGE_LIMIT = 50;
export const MIN_API_PAGE_LIMIT = 1;
export const MAX_API_PAGE_LIMIT = 100;

type ExtensionListQuery = NonNullable<GetExtensionsData['query']>;
type ExtensionMineQuery = NonNullable<GetExtensionsMineData['query']>;
type RevisionHistoryQuery = NonNullable<
  GetExtensionsByIdRevisionsData['query']
>;
type ModerationQueueQuery = NonNullable<GetModerationExtensionsData['query']>;

export type ExtensionCatalogueFilters = Pick<
  ExtensionListQuery,
  'type' | 'developer_id' | 'limit' | 'cursor'
>;

export type ExtensionMineFilters = Pick<
  ExtensionMineQuery,
  'type' | 'limit' | 'cursor'
>;

export type RevisionHistoryOptions = Pick<
  RevisionHistoryQuery,
  'cursor' | 'limit'
>;

export type ModerationQueueOptions = Pick<
  ModerationQueueQuery,
  'cursor' | 'limit'
>;

export type RevisionHistoryPage = GetExtensionsByIdRevisionsResponse;
export type ModerationQueuePage = GetModerationExtensionsResponse;
export type DeveloperProfileInput = NonNullable<PutDevelopersMeData['body']>;
export type RevisionStatus = Exclude<ModerationQueueQuery['status'], undefined>;

export type AccountUser = User;
export type IdentitySyncInput = UserIdentityInput;
export type OwnedDeveloper = OwnedDeveloperProfile;

export type {
  Developer,
  DeveloperApproval,
  DeveloperClaim,
  DeveloperHistoryEntry,
  DeveloperProfile,
  DeveloperTransfer,
  Extension,
  ExtensionCreate,
  ExtensionListItem,
  ExtensionListResponse,
  ExtensionRevision,
  ExtensionUpdate,
  OwnedExtension,
  OwnedExtensionListItem,
  OwnedExtensionListResponse,
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
): ExtensionMineQuery {
  const query: ExtensionMineQuery = {
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

export async function listExtensions(
  env: ApplicationEnv,
  filters: ExtensionCatalogueFilters = {},
): Promise<ExtensionListResponse> {
  return unwrap(
    await getExtensions({
      client: createApiTransport(env),
      query: extensionQuery(filters),
    }),
  );
}

export async function getExtensionById(
  env: ApplicationEnv,
  id: string,
): Promise<Extension> {
  const response = await getExtensionsById({
    client: createApiTransport(env),
    path: { id },
  });
  const data = await unwrap(response);
  return data.result;
}

export async function getDeveloperById(
  env: ApplicationEnv,
  id: string,
): Promise<import('@/lib/api/generated/extensions-v2').PublicDeveloper> {
  return unwrap(
    await getDevelopersById({
      client: createApiTransport(env),
      path: { id },
    }),
  ).then((response) => response.result);
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
    ): Promise<OwnedExtensionListResponse> =>
      unwrap(
        await getExtensionsMine({
          client,
          query: mineExtensionQuery(options),
        }),
      ),

    getMyExtension: async (id: string): Promise<OwnedExtension> =>
      (
        await unwrap(
          await getExtensionsMineById({
            client,
            path: { id },
          }),
        )
      ).result,

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
        await getModerationExtensions({
          client,
          query: { status, ...pageQuery(options) },
        }),
      ),

    approveRevision: async (
      extensionId: string,
      revisionId: string,
      reviewNote?: string,
    ) =>
      (
        await unwrap(
          await postExtensionsByIdRevisionsByRevisionIdApprove({
            client,
            path: { id: extensionId, revisionId },
            ...(reviewNote ? { body: { review_note: reviewNote } } : {}),
          }),
        )
      ).result,

    rejectRevision: async (
      extensionId: string,
      revisionId: string,
      reviewNote: string,
    ) =>
      (
        await unwrap(
          await postExtensionsByIdRevisionsByRevisionIdReject({
            client,
            path: { id: extensionId, revisionId },
            body: { review_note: reviewNote },
          }),
        )
      ).result,

    // Removes an already-published extension from the public catalogue.
    // Distinct from rejectRevision: this acts on the extension itself, not a
    // pending edit, and there is no owner-facing equivalent — see the
    // extensions-v2 service README's "Extension Lifecycle" section.
    delistExtension: async (extensionId: string, reason: string) =>
      (
        await unwrap(
          await postExtensionsByIdDelist({
            client,
            path: { id: extensionId },
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
      (
        await unwrap(
          await getDevelopersUnapproved({
            client,
          }),
        )
      ).result,

    listAllDevelopers: async () =>
      (
        await unwrap(
          await getDevelopers({
            client,
          }),
        )
      ).result,

    approveDeveloper: async (id: string, expectedRevision: number) =>
      (
        await unwrap(
          await postDevelopersByIdApprove({
            client,
            path: { id },
            body: {
              expected_revision: expectedRevision,
            } satisfies DeveloperApproval,
          }),
        )
      ).result,

    listDeveloperHistory: async (id: string) =>
      (
        await unwrap(
          await getDevelopersByIdHistory({
            client,
            path: { id },
          }),
        )
      ).result,

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
      (
        await unwrap(
          await getDevelopersClaimsMine({
            client,
          }),
        )
      ).result,

    listPendingClaims: async () =>
      (
        await unwrap(
          await getDevelopersClaims({
            client,
          }),
        )
      ).result,

    approveClaim: async (id: string) =>
      (
        await unwrap(
          await postDevelopersClaimsByIdApprove({
            client,
            path: { id },
          }),
        )
      ).result,

    rejectClaim: async (id: string, reviewNote: string) =>
      (
        await unwrap(
          await postDevelopersClaimsByIdReject({
            client,
            path: { id },
            body: { review_note: reviewNote },
          }),
        )
      ).result,
  };
}
