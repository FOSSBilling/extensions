import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/apiClient';

export const POST: APIRoute = async (context) => {
  const guard = await requireModerator(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const { id } = context.params;
  if (!id) return context.redirect('/account/moderate/developers/claims');

  const api = createApiClient(env, user.sub);
  try {
    await api.approveClaim(id);
  } catch (e) {
    const message =
      e instanceof ApiRequestError ? e.message : 'Unable to approve claim.';
    return context.redirect(
      `/account/moderate/developers/claims?error=${encodeURIComponent(message)}`,
    );
  }

  return context.redirect('/account/moderate/developers/claims');
};
