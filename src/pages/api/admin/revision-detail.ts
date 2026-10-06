import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { apiErrorResponse, createApiClient } from '@/lib/api/client';

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
    return apiErrorResponse(error, 'Unable to load extension.');
  }
};
