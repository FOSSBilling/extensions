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

  // github_org_verified is `undefined` when the check was inconclusive (no
  // linked GitHub identity — see the api repo's reverifyOwn) rather than an
  // actual mismatch, which is `false`. Conflating the two would show "no
  // longer matches" for a case that isn't a mismatch at all.
  setFlash(context.session, {
    category:
      result.github_org_verified === true
        ? 'success'
        : result.github_org_verified === false
          ? 'warning'
          : 'info',
    title: 'GitHub verification re-checked',
    description:
      result.github_org_verified === true
        ? 'Your linked GitHub identity matches this profile.'
        : result.github_org_verified === false
          ? "Your linked GitHub identity doesn't currently match this profile."
          : 'No linked GitHub identity was found to check against.',
  });
  return context.redirect('/account');
};
