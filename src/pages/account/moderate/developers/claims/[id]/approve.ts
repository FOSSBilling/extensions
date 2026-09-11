import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { formFlag } from '@/lib/form';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireModerator(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const { id } = context.params;
  if (!id) return context.redirect('/account/moderate/developers/claims');

  // The approve form carries only the notify checkbox; a bodyless POST from
  // anywhere else still defaults to notifying.
  let notify = true;
  try {
    notify = formFlag(await context.request.formData(), 'notify');
  } catch {
    // No readable body — keep the default.
  }

  const api = createApiClient(env, user.sub);
  try {
    const result = await api.approveClaim(id, notify);
    if (notify && !result.notified) {
      setFlash(context.session, {
        category: 'warning',
        title: 'Claim approved, but the claimant could not be emailed.',
      });
    }
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to approve claim.';
    setFlash(context.session, { category: 'error', title: message });
  }

  return context.redirect('/account/moderate/developers/claims');
};
