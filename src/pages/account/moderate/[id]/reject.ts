import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/apiClient';

export const POST: APIRoute = async (context) => {
  const guard = await requireModerator(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const { id } = context.params;
  if (!id) return context.redirect('/account/moderate');

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(
      `/account/moderate?error=${encodeURIComponent('Malformed request.')}`,
    );
  }
  const reviewNote = ((form.get('review_note') as string | null) ?? '').trim();
  if (!reviewNote) {
    return context.redirect(
      `/account/moderate?error=${encodeURIComponent('A reason is required to reject a submission.')}`,
    );
  }

  const api = createApiClient(env, user.sub);
  try {
    await api.rejectSubmission(id, reviewNote);
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to reject submission.';
    return context.redirect(
      `/account/moderate?error=${encodeURIComponent(message)}`,
    );
  }

  return context.redirect('/account/moderate');
};
