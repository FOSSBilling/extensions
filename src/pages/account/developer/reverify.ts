import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth-guard';
import { getDeveloperByOwner } from '@/lib/database';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireUser(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const cooldownUntil =
    (await context.session?.get('reverifyCooldownUntil')) ?? 0;
  if (cooldownUntil > Date.now()) {
    setFlash(context.session, {
      category: 'error',
      title: 'Could not refresh GitHub verification',
      description:
        'GitHub verification is temporarily unavailable. Please wait until the one-minute cooldown ends, then retry manually.',
    });
    return context.redirect('/account');
  }
  context.session?.delete('reverifyCooldownUntil');

  const developer = await getDeveloperByOwner(env.db, user.sub);
  if (!developer) return context.redirect('/account');

  const api = createApiClient(env, user.sub);
  let result;
  try {
    result = await api.reverifyDeveloper(true);
  } catch (e) {
    let description =
      'Unable to refresh your GitHub verification right now. Please try again manually.';

    if (e instanceof ApiRequestError) {
      switch (e.code) {
        case 'RATE_LIMITED':
          description =
            'GitHub verification is temporarily rate limited. Please wait one minute, then retry manually.';
          context.session?.set('reverifyCooldownUntil', Date.now() + 60_000);
          break;
        case 'SERVICE_UNAVAILABLE':
          description =
            'GitHub verification is temporarily unavailable. Please wait one minute, then retry manually.';
          context.session?.set('reverifyCooldownUntil', Date.now() + 60_000);
          break;
        case 'GITHUB_ENTITY_UNSUPPORTED':
          description =
            'This type of GitHub entity is not supported. Change the linked GitHub account or Publisher ID before re-verifying; retrying unchanged will not help.';
          break;
        default:
          description = e.message;
      }
    }

    setFlash(context.session, {
      category: 'error',
      title: 'Could not refresh GitHub verification',
      description,
    });
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
