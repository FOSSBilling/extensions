import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { ApiRequestError, createApiClient } from '@/lib/api/client';

// On-demand published content for the revision queue's "compare with live"
// affordance. The queue page itself makes zero detail queries; the client
// fetches this once per expanded card (and caches per extension id).
export const GET: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireModerator(context, env);
  if (guard instanceof Response) return guard;

  const extensionId = context.url.searchParams.get('extensionId')?.trim();
  if (!extensionId) {
    return Response.json(
      { error: { code: 'missing_id', message: 'extensionId is required.' } },
      { status: 422 },
    );
  }

  try {
    const api = createApiClient(env, guard.sub);
    const ext = await api.getModerationExtension(extensionId);
    return Response.json({
      result: {
        extension_id: ext.id,
        developer: ext.developer,
        published: ext.published ?? null,
        pending_revision_id: ext.pending_revision?.id ?? null,
        delisted: ext.delisted ?? null,
      },
    });
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
        error: { code: 'request_failed', message: 'Unable to load extension.' },
      },
      { status: 502 },
    );
  }
};
