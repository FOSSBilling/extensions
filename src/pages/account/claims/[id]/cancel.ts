import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireUser(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const { id } = context.params;
  if (!id) return context.redirect('/account');

  const api = createApiClient(env, user.sub);
  try {
    await api.cancelClaim(id);
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to cancel claim.';
    setFlash(context.session, { category: 'error', title: message });
    return context.redirect('/account');
  }

  setFlash(context.session, { title: 'Claim Cancelled.' });
  return context.redirect('/account');
};
