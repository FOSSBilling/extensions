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

  // The approve form carries only the notify checkbox plus an intent marker;
  // a POST from anywhere else — bodyless, or an empty form that parses with
  // no fields — keeps the notifying default instead of reading the absent
  // checkbox as an opt-out.
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
    if (notify && !result.notified) {
      setFlash(context.session, {
        category: 'warning',
        title: 'Revision approved, but the author could not be emailed.',
      });
    }
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to approve revision.';
    setFlash(context.session, { category: 'error', title: message });
  }

  return context.redirect('/account/moderate');
};
