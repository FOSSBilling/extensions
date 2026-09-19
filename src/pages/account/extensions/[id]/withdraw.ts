import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { purgeCatalogue } from '@/lib/cache-invalidate';
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
    await api.withdrawExtension(id);
    purgeCatalogue(context);
  } catch (e) {
    const message =
      e instanceof ApiRequestError
        ? e.message
        : 'Unable to withdraw extension.';
    setFlash(context, env.sessionSecret, { category: 'error', title: message });
    return context.redirect(`/account/extensions/${id}/edit`);
  }

  setFlash(context, env.sessionSecret, { title: 'Extension withdrawn.' });
  return context.redirect('/account');
};
