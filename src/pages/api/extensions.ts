import type { APIRoute } from 'astro';
import { apiErrorResponse, listExtensions } from '@/lib/api/client';
import { parseCatalogueFilters } from '@/lib/catalogue-filters';
import { getSignedImageUrl } from '@/lib/signed-image-url';

export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.env;
  const parsed = parseCatalogueFilters(url.searchParams);
  if (parsed.error !== null) {
    return Response.json(
      {
        error: {
          code: 'INVALID_EXTENSION_TYPE',
          message: parsed.error,
        },
      },
      { status: 422 },
    );
  }

  try {
    // Short browser TTL so repeated Load-more/filter requests reuse the same
    // cursor page; the edge cache for the underlying read lives in the
    // client-layer catalogue wrapper.
    const page = await listExtensions(env, parsed.filters);
    const result = await Promise.all(
      page.result.map(async (item) => ({
        ...item,
        optimized_icon_url: await getSignedImageUrl(
          item.icon_url,
          'icon',
          env.sessionSecret,
        ),
      })),
    );
    return Response.json(
      { ...page, result },
      {
        headers: { 'cache-control': 'public, max-age=30' },
      },
    );
  } catch (error) {
    return apiErrorResponse(error, 'The extensions API request failed.');
  }
};
