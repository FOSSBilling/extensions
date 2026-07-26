import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/apiClient';
import { formString } from '@/lib/form';

export const POST: APIRoute = async (context) => {
  const guard = await requireModerator(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const { id } = context.params;
  if (!id) return context.redirect('/account/moderate/developers');

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(
      `/account/moderate/developers?error=${encodeURIComponent('Malformed request.')}`,
    );
  }
  const expectedRevision = Number(formString(form, 'expected_revision'));
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return context.redirect(
      `/account/moderate/developers?error=${encodeURIComponent('Missing or invalid profile revision.')}`,
    );
  }

  const api = createApiClient(env, user.sub);
  try {
    await api.approveDeveloper(id, expectedRevision);
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to approve profile.';
    return context.redirect(
      `/account/moderate/developers?error=${encodeURIComponent(message)}`,
    );
  }

  return context.redirect('/account/moderate/developers');
};
