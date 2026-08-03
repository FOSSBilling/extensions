import type { APIRoute } from 'astro';
import {
  ApiRequestError,
  listExtensions,
  type ExtensionCatalogueFilters,
} from '@/lib/api/client';
import { isExtensionType } from '@/types';

export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.env;
  const filters: ExtensionCatalogueFilters = {};
  const type = url.searchParams.get('type');
  const developerId = url.searchParams.get('developer_id');
  const limit = url.searchParams.get('limit');

  if (type !== null && type !== '' && !isExtensionType(type)) {
    return Response.json(
      {
        error: {
          code: 'INVALID_EXTENSION_TYPE',
          message: 'The extension type filter is invalid.',
        },
      },
      { status: 422 },
    );
  }
  if (type) {
    filters.type = type;
  }
  if (developerId !== null) {
    filters.developer_id = developerId;
  }
  if (limit !== null) {
    const parsedLimit = Number(limit);
    if (Number.isFinite(parsedLimit)) {
      filters.limit = parsedLimit;
    }
  }
  if (url.searchParams.has('cursor')) {
    filters.cursor = url.searchParams.get('cursor') ?? '';
  }

  try {
    return Response.json(await listExtensions(env, filters));
  } catch (error) {
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
      {
        error: {
          code: 'request_failed',
          message: 'The extensions API request failed.',
        },
      },
      { status: 502 },
    );
  }
};
