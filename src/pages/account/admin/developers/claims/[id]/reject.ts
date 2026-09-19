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

  const { id } = context.params;
  if (!id) return context.redirect('/account/admin/developers/claims');

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    setFlash(context, env.sessionSecret, {
      category: 'error',
      title: 'Malformed request.',
    });
    return context.redirect('/account/admin/developers/claims');
  }
  const reviewNote = formString(form, 'review_note');
  if (!reviewNote) {
    setFlash(context, env.sessionSecret, {
      category: 'error',
      title: 'A reason is required to reject a claim.',
    });
    return context.redirect('/account/admin/developers/claims');
  }

  const api = createApiClient(env, user.sub);
  const notify = formFlag(form, 'notify');
  try {
    const result = await api.rejectClaim(id, reviewNote, notify);
    if (notify && !result.notified) {
      setFlash(context, env.sessionSecret, {
        category: 'warning',
        title: 'Claim rejected, but the claimant could not be emailed.',
      });
    }
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to reject claim.';
    setFlash(context, env.sessionSecret, { category: 'error', title: message });
  }

  return context.redirect('/account/admin/developers/claims');
};
