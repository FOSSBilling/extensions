import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth-guard';
import { getDeveloperByOwner } from '@/lib/extensions-data';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { purgeCatalogue } from '@/lib/cache-invalidate';
import { setFlash } from '@/lib/flash';
import { buildGithubReconnectUrl } from '@/lib/oauth';
import {
  setReverifyCooldown,
  takeReverifyCooldown,
} from '@/lib/reverify-cooldown';

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireUser(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const cooldownUntil = await takeReverifyCooldown(
    context.cookies,
    env.sessionSecret,
  );
  if (cooldownUntil > Date.now()) {
    await setFlash(context, env.sessionSecret, {
      category: 'error',
      title: 'Could not refresh GitHub verification',
      description:
        'GitHub verification is temporarily unavailable. Please wait until the one-minute cooldown ends, then retry manually.',
    });
    return context.redirect('/account');
  }

  const developer = await getDeveloperByOwner(env, user.sub);
  if (!developer) return context.redirect('/account');

  const api = createApiClient(env, user.sub);
  let result;
  try {
    result = await api.reverifyDeveloper(true);
    purgeCatalogue(context);
  } catch (e) {
    let description =
      'Unable to refresh your GitHub verification right now. Please try again manually.';

    if (e instanceof ApiRequestError) {
      switch (e.code) {
        // Both transient conditions share the cooldown: retrying within a
        // minute cannot succeed, so the retry button is suppressed until it
        // lapses (see the cooldown check at the top).
        case 'RATE_LIMITED':
        case 'SERVICE_UNAVAILABLE': {
          await setReverifyCooldown(context, env.sessionSecret);
          const condition =
            e.code === 'RATE_LIMITED' ? 'rate limited' : 'unavailable';
          description = `GitHub verification is temporarily ${condition}. Please wait one minute, then retry manually.`;
          break;
        }
        case 'GITHUB_ENTITY_UNSUPPORTED':
          description =
            'This type of GitHub entity is not supported. Change the linked GitHub account or Publisher ID before re-verifying; retrying unchanged will not help.';
          break;
        default:
          description = e.message;
      }
    }

    await setFlash(context, env.sessionSecret, {
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
  //
  // A reported mismatch can't be fixed by retrying: re-verify only
  // re-checks the already-synced snapshot, so link the re-link flow (which
  // re-fetches org memberships) directly from the warning toast.
  const reconnectUrl = buildGithubReconnectUrl(context.url.origin, '/account');
  const mismatch = result.github_org_verified === false;
  await setFlash(context, env.sessionSecret, {
    category:
      result.github_org_verified === true
        ? 'success'
        : mismatch
          ? 'warning'
          : 'info',
    title: 'GitHub verification re-checked',
    description:
      result.github_org_verified === true
        ? 'Your linked GitHub identity matches this profile.'
        : mismatch
          ? "Your linked GitHub identity doesn't currently match this profile. If it should (e.g. you rejoined the organization), reconnect GitHub to refresh your organization access, then re-verify."
          : 'No linked GitHub identity was found to check against.',
    action: mismatch
      ? { label: 'Reconnect GitHub', href: reconnectUrl }
      : undefined,
  });
  return context.redirect('/account');
};
