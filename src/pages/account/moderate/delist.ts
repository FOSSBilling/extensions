import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { formString } from '@/lib/form';
import { setFlash } from '@/lib/flash';

// Unlike approve/reject, which act on a queue entry the moderator is already
// looking at, delist targets an arbitrary published extension by id typed
// into the form below — so the id travels in the form body rather than the
// URL path.
export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireModerator(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    setFlash(context.session, {
      category: 'error',
      title: 'Malformed request.',
    });
    return context.redirect('/account/moderate');
  }

  const id = formString(form, 'id');
  const reason = formString(form, 'reason');
  if (!id || !reason) {
    setFlash(context.session, {
      category: 'error',
      title: 'An extension id and a reason are both required to delist.',
    });
    return context.redirect('/account/moderate');
  }

  const api = createApiClient(env, user.sub);
  try {
    await api.delistExtension(id, reason);
    setFlash(context.session, {
      category: 'success',
      title: `"${id}" removed from the catalogue.`,
    });
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to delist extension.';
    setFlash(context.session, { category: 'error', title: message });
  }

  return context.redirect('/account/moderate');
};
