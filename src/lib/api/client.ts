import {
  deleteDevelopersMe,
  getDevelopers,
  getDevelopersById,
  getDevelopersByIdHistory,
  getDevelopersClaims,
  getDevelopersClaimsMine,
  getDevelopersMe,
  getDevelopersUnapproved,
  getExtensions,
  getExtensionsById,
  getExtensionsMine,
  getSubmissionsMine,
  getSubmissionsQueue,
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
  postSubmissions,
  postSubmissionsByIdApprove,
  postSubmissionsByIdReject,
  deleteUsersMe,
  putDevelopersMe,
  putUsersMeIdentity,
  type Developer,
  type DeveloperApproval,
  type DeveloperClaim,
  type DeveloperHistoryEntry,
  type DeveloperProfile,
  type DeveloperTransfer,
  type Error as ApiErrorBody,
  type Extension,
  type ExtensionListItem,
  type ExtensionListResponse,
  type GetExtensionsData,
  type GetExtensionsMineData,
  type GetSubmissionsMineResponse,
  type GetSubmissionsMineData,
  type GetSubmissionsQueueData,
  type GetSubmissionsQueueResponse,
  type OwnedDeveloperProfile,
  type PendingDeveloperClaim,
  type User,
  type UserIdentityInput,
  type PutDevelopersMeData,
  type Submission,
  type SubmissionPayload,
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
type SubmissionPageQuery = NonNullable<GetSubmissionsMineData['query']>;
type SubmissionQueueQuery = NonNullable<GetSubmissionsQueueData['query']>;

export type ExtensionCatalogueFilters = Pick<
  ExtensionListQuery,
  'type' | 'developer_id' | 'limit' | 'cursor'
>;

export type ExtensionMineFilters = Pick<
  ExtensionMineQuery,
  'type' | 'limit' | 'cursor'
>;

export type SubmissionPageOptions = Pick<
  SubmissionPageQuery,
  'cursor' | 'limit'
>;

export type SubmissionPage = GetSubmissionsMineResponse;
export type SubmissionQueuePage = GetSubmissionsQueueResponse;
export type DeveloperProfileInput = NonNullable<PutDevelopersMeData['body']>;
export type SubmissionStatus = Exclude<
  SubmissionQueueQuery['status'],
  undefined
>;

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
  ExtensionListItem,
  ExtensionListResponse,
  PendingDeveloperClaim,
  Submission,
  SubmissionPayload,
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
  options: SubmissionPageOptions = {},
): NonNullable<GetSubmissionsMineData['query']> {
  const query: NonNullable<GetSubmissionsMineData['query']> = {
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
    ): Promise<ExtensionListResponse> =>
      unwrap(
        await getExtensionsMine({
          client,
          query: mineExtensionQuery(options),
        }),
      ),

    submitExtension: async (payload: SubmissionPayload) =>
      (await unwrap(await postSubmissions({ client, body: payload }))).result,

    listMySubmissions: async (
      options: SubmissionPageOptions = {},
    ): Promise<SubmissionPage> =>
      unwrap(
        await getSubmissionsMine({
          client,
          query: pageQuery(options),
        }),
      ),

    listQueue: async (
      status: SubmissionStatus = 'pending',
      options: SubmissionPageOptions = {},
    ): Promise<SubmissionQueuePage> =>
      unwrap(
        await getSubmissionsQueue({
          client,
          query: { status, ...pageQuery(options) },
        }),
      ),

    approveSubmission: async (id: string, reviewNote?: string) =>
      (
        await unwrap(
          await postSubmissionsByIdApprove({
            client,
            path: { id },
            ...(reviewNote ? { body: { review_note: reviewNote } } : {}),
          }),
        )
      ).result,

    rejectSubmission: async (id: string, reviewNote: string) =>
      (
        await unwrap(
          await postSubmissionsByIdReject({
            client,
            path: { id },
            body: { review_note: reviewNote },
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
