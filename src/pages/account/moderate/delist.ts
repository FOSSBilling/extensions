import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { formFlag, formString } from '@/lib/form';
import { setFlash } from '@/lib/flash';

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
  const notify = formFlag(form, 'notify');

  const api = createApiClient(env, user.sub);
  try {
    const result = await api.delistExtension(id, reason, notify);
    let description = 'The author has been emailed.';
    if (!notify) {
      description = 'The author was not emailed, as requested.';
    } else if (!result.notified) {
      description =
        'The author could not be emailed — no address on file or sending failed.';
    }
    setFlash(context.session, {
      category: 'success',
      title: `"${id}" removed from the catalogue.`,
      description,
    });
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to delist extension.';
    setFlash(context.session, { category: 'error', title: message });
  }

  return context.redirect('/account/moderate');
};
