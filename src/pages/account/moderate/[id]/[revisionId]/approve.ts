import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireModerator(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const { id, revisionId } = context.params;
  if (!id || !revisionId) return context.redirect('/account/moderate');

  const api = createApiClient(env, user.sub);
  try {
    await api.approveRevision(id, revisionId);
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to approve revision.';
    setFlash(context.session, { category: 'error', title: message });
  }

  return context.redirect('/account/moderate');
};
