import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { requireUser } from '@/lib/auth-guard';
import { getDeveloperByOwner } from '@/lib/database';
import { createApiClient, ApiRequestError } from '@/lib/apiClient';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = async (context) => {
  const guard = await requireUser(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const developer = await getDeveloperByOwner(env.DB_EXTENSIONS, user.sub);
  if (!developer) return context.redirect('/account');

  const api = createApiClient(env, user.sub);
  let result;
  try {
    result = await api.reverifyDeveloper(true);
  } catch (e) {
    const message =
      e instanceof ApiRequestError
        ? e.message
        : 'Unable to re-verify your GitHub identity right now. Please try again.';
    setFlash(context.session, { category: 'error', title: message });
    return context.redirect('/account');
  }

  setFlash(context.session, {
    category: result.github_org_verified ? 'success' : 'warning',
    title: 'GitHub verification re-checked',
    description: result.github_org_verified
      ? 'Your linked GitHub identity matches this profile.'
      : "Your linked GitHub identity doesn't currently match this profile.",
  });
  return context.redirect('/account');
};
