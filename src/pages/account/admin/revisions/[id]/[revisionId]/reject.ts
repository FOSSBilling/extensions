import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { formFlag, formString } from '@/lib/form';
import { purgeCatalogue } from '@/lib/cache-invalidate';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireModerator(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const { id, revisionId } = context.params;
  if (!id || !revisionId) return context.redirect('/account/admin/revisions');

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    setFlash(context, env.sessionSecret, {
      category: 'error',
      title: 'Malformed request.',
    });
    return context.redirect('/account/admin/revisions');
  }
  const reviewNote = formString(form, 'review_note');
  if (!reviewNote) {
    setFlash(context, env.sessionSecret, {
      category: 'error',
      title: 'A reason is required to reject a revision.',
    });
    return context.redirect('/account/admin/revisions');
  }

  const api = createApiClient(env, user.sub);
  const notify = formFlag(form, 'notify');
  try {
    const result = await api.rejectRevision(id, revisionId, reviewNote, notify);
    purgeCatalogue(context);
    if (notify && !result.notified) {
      setFlash(context, env.sessionSecret, {
        category: 'warning',
        title: 'Revision rejected, but the author could not be emailed.',
      });
    }
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to reject revision.';
    setFlash(context, env.sessionSecret, { category: 'error', title: message });
  }

  return context.redirect('/account/admin/revisions');
};
