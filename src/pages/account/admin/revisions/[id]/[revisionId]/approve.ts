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

  let notify = true;
  try {
    const form = await context.request.formData();
    if (formString(form, 'intent') === 'approve') {
      notify = formFlag(form, 'notify');
    }
  } catch {
    // No readable body — keep the default.
  }

  const api = createApiClient(env, user.sub);
  try {
    const result = await api.approveRevision(id, revisionId, undefined, notify);
    purgeCatalogue(context);
    if (notify && !result.notified) {
      setFlash(context, env.sessionSecret, {
        category: 'warning',
        title: 'Revision approved, but the author could not be emailed.',
      });
    }
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to approve revision.';
    setFlash(context, env.sessionSecret, { category: 'error', title: message });
  }

  return context.redirect('/account/admin/revisions');
};
