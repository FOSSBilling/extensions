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

  const { id, revisionId } = context.params;
  if (!id || !revisionId) return context.redirect('/account/moderate');

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
  const reviewNote = formString(form, 'review_note');
  if (!reviewNote) {
    setFlash(context.session, {
      category: 'error',
      title: 'A reason is required to reject a revision.',
    });
    return context.redirect('/account/moderate');
  }

  const api = createApiClient(env, user.sub);
  const notify = formFlag(form, 'notify');
  try {
    const result = await api.rejectRevision(id, revisionId, reviewNote, notify);
    if (notify && !result.notified) {
      setFlash(context.session, {
        category: 'warning',
        title: 'Revision rejected, but the author could not be emailed.',
      });
    }
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to reject revision.';
    setFlash(context.session, { category: 'error', title: message });
  }

  return context.redirect('/account/moderate');
};
