import {
  getExtensions,
  getExtensionsById,
  type Error as ExtensionsApiErrorBody,
  type Extension,
  type ExtensionListItem,
  type ExtensionListResponse,
  type GetExtensionsData,
} from '@/generated/extensions-v2';
import { createClient } from '@/generated/extensions-v2/client';

export const DEFAULT_EXTENSION_PAGE_LIMIT = 50;
export const MIN_EXTENSION_PAGE_LIMIT = 1;
export const MAX_EXTENSION_PAGE_LIMIT = 100;

type ExtensionListQuery = NonNullable<GetExtensionsData['query']>;

export type ExtensionCatalogueFilters = Pick<
  ExtensionListQuery,
  'type' | 'developer_id' | 'cursor'
> & {
  limit?: number;
};

export type { Extension, ExtensionListItem, ExtensionListResponse };

export class ExtensionsApiError extends Error {
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
    this.name = 'ExtensionsApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function clampExtensionPageLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_EXTENSION_PAGE_LIMIT;
  }

  return Math.min(
    MAX_EXTENSION_PAGE_LIMIT,
    Math.max(MIN_EXTENSION_PAGE_LIMIT, Math.trunc(limit)),
  );
}

function createExtensionsClient(env: Cloudflare.Env) {
  const baseUrl = env.EXTENSIONS_API_BASE_URL.replace(/\/$/, '');

  return createClient({
    baseUrl: `${baseUrl}/extensions/v2`,
  });
}

function apiErrorFrom(
  error: unknown,
  status: number | undefined,
): ExtensionsApiError {
  const body = error as Partial<ExtensionsApiErrorBody> | null;
  const nested = body?.error;

  if (nested && typeof nested === 'object') {
    return new ExtensionsApiError(
      status ?? 502,
      nested.code,
      nested.message,
      nested.details,
    );
  }

  return new ExtensionsApiError(
    status ?? 502,
    'request_failed',
    error instanceof Error
      ? error.message
      : 'The extensions API request failed.',
  );
}

export async function listExtensions(
  env: Cloudflare.Env,
  filters: ExtensionCatalogueFilters = {},
): Promise<ExtensionListResponse> {
  const query: ExtensionListQuery = {
    limit: clampExtensionPageLimit(filters.limit),
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

  const result = await getExtensions({
    client: createExtensionsClient(env),
    query,
  });

  if (result.data !== undefined) {
    return result.data;
  }

  throw apiErrorFrom(result.error, result.response?.status);
}

export async function getExtensionById(
  env: Cloudflare.Env,
  id: string,
): Promise<Extension> {
  const result = await getExtensionsById({
    client: createExtensionsClient(env),
    path: { id },
  });

  if (result.data !== undefined) {
    return result.data.result;
  }

  throw apiErrorFrom(result.error, result.response?.status);
}
