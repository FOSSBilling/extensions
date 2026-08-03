import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { formString } from '@/lib/form';
import { setFlash } from '@/lib/flash';

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
    setFlash(context.session, {
      category: 'error',
      title: 'Malformed request.',
    });
    return context.redirect('/account/moderate/developers');
  }
  const expectedRevision = Number(formString(form, 'expected_revision'));
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    setFlash(context.session, {
      category: 'error',
      title: 'Missing or invalid profile revision.',
    });
    return context.redirect('/account/moderate/developers');
  }

  const api = createApiClient(env, user.sub);
  try {
    await api.approveDeveloper(id, expectedRevision);
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to approve profile.';
    setFlash(context.session, { category: 'error', title: message });
  }

  return context.redirect('/account/moderate/developers');
};
