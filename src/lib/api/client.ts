import {
  deleteDevelopersMe,
  getDevelopers,
  getDevelopersByIdHistory,
  getDevelopersClaims,
  getDevelopersClaimsMine,
  getDevelopersUnapproved,
  getExtensions,
  getExtensionsById,
  getSubmissionsMine,
  getSubmissionsQueue,
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
  putDevelopersMe,
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
  type GetSubmissionsMineResponse,
  type GetSubmissionsMineData,
  type GetSubmissionsQueueData,
  type GetSubmissionsQueueResponse,
  type PendingDeveloperClaim,
  type PutDevelopersMeData,
  type Submission,
  type SubmissionPayload,
} from '@/lib/api/generated/extensions-v2';
import {
  createClient,
  type Client,
} from '@/lib/api/generated/extensions-v2/client';
import { mintBearerAssertion } from '../assertion';

export const DEFAULT_API_PAGE_LIMIT = 50;
export const MIN_API_PAGE_LIMIT = 1;
export const MAX_API_PAGE_LIMIT = 100;

type ExtensionListQuery = NonNullable<GetExtensionsData['query']>;
type SubmissionPageQuery = NonNullable<GetSubmissionsMineData['query']>;
type SubmissionQueueQuery = NonNullable<GetSubmissionsQueueData['query']>;

export type ExtensionCatalogueFilters = Pick<
  ExtensionListQuery,
  'type' | 'developer_id' | 'limit' | 'cursor'
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

function createApiTransport(env: Cloudflare.Env, subject?: string): Client {
  const baseUrl = env.EXTENSIONS_API_BASE_URL.replace(/\/$/, '');

  return createClient({
    baseUrl: `${baseUrl}/extensions/v2`,
    ...(subject
      ? {
          auth: () =>
            mintBearerAssertion(subject, env.ASSERTION_SIGNING_SECRET),
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

export async function listExtensions(
  env: Cloudflare.Env,
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
  env: Cloudflare.Env,
  id: string,
): Promise<Extension> {
  const response = await getExtensionsById({
    client: createApiTransport(env),
    path: { id },
  });
  const data = await unwrap(response);
  return data.result;
}

export function createApiClient(env: Cloudflare.Env, subject: string) {
  const client = createApiTransport(env, subject);

  return {
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

export async function listMyClaimsSafely(
  api: ReturnType<typeof createApiClient>,
): Promise<DeveloperClaim[]> {
  try {
    return await api.listMyClaims();
  } catch {
    return [];
  }
}
