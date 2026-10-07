import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { apiErrorResponse, createApiClient } from '@/lib/api/client';

// The queue contains metadata only. Fetch one revision on expansion and
// include live content only when a comparison was requested.
export const GET: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireModerator(context, env);
  if (guard instanceof Response) return guard;

  const extensionId = context.url.searchParams.get('extensionId')?.trim();
  const revisionId = context.url.searchParams.get('revisionId')?.trim();
  if (!extensionId || !revisionId) {
    return Response.json(
      {
        error: {
          code: 'missing_id',
          message: 'extensionId and revisionId are required.',
        },
      },
      { status: 422 },
    );
  }

  try {
    const api = createApiClient(env, guard.sub);
    const revision = await api.getRevision(extensionId, revisionId);
    if (!revision.content_available || !revision.content)
      return Response.json(
        {
          error: {
            code: 'content_unavailable',
            message: revision.compacted_at
              ? 'Reviewed content is no longer retained.'
              : 'Revision content is unavailable.',
          },
        },
        { status: 409 },
      );
    const ext =
      context.url.searchParams.get('compare') === '1'
        ? await api.getModerationExtension(extensionId)
        : null;
    return Response.json({
      result: {
        extension_id: revision.extension_id,
        revision: revision.content,
        published: ext?.published ?? null,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, 'Unable to load extension.');
  }
};
