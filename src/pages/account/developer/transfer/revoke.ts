import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth-guard';
import { getDeveloperByOwner } from '@/lib/extensions-data';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireUser(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const developer = await getDeveloperByOwner(env, user.sub);
  if (!developer) return context.redirect('/account/developer');

  const api = createApiClient(env, user.sub);
  try {
    await api.revokeTransfer(developer.id);
  } catch (e) {
    const message =
      e instanceof ApiRequestError
        ? e.message
        : 'Unable to revoke the pending transfer.';
    setFlash(context.session, { category: 'error', title: message });
    return context.redirect('/account/developer');
  }

  setFlash(context.session, { title: 'Pending transfer link revoked.' });
  return context.redirect('/account/developer');
};
