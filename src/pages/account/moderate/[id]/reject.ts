import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { formString } from '@/lib/form';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireModerator(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const { id } = context.params;
  if (!id) return context.redirect('/account/moderate');

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
      title: 'A reason is required to reject a submission.',
    });
    return context.redirect('/account/moderate');
  }

  const api = createApiClient(env, user.sub);
  try {
    await api.rejectSubmission(id, reviewNote);
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to reject submission.';
    setFlash(context.session, { category: 'error', title: message });
  }

  return context.redirect('/account/moderate');
};
