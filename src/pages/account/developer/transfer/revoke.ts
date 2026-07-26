import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { requireUser } from '@/lib/auth-guard';
import { getDeveloperByOwner } from '@/lib/database';
import { createApiClient, ApiRequestError } from '@/lib/apiClient';

export const POST: APIRoute = async (context) => {
  const guard = await requireUser(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const developer = await getDeveloperByOwner(env.DB_EXTENSIONS, user.sub);
  if (!developer) return context.redirect('/account/developer');

  const api = createApiClient(env, user.sub);
  try {
    await api.revokeTransfer(developer.id);
  } catch (e) {
    const message =
      e instanceof ApiRequestError
        ? e.message
        : 'Unable to revoke the pending transfer.';
    return context.redirect(
      `/account/developer?error=${encodeURIComponent(message)}`,
    );
  }

  return context.redirect('/account/developer?transfer_revoked=1');
};
