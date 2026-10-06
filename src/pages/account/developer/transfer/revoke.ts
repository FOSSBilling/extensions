import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth-guard';
import { createApiClient } from '@/lib/api/client';
import { formAction } from '@/lib/form-action';
import { getDeveloperByOwner } from '@/lib/extensions-data';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = formAction({
  guard: requireUser,
  redirect: '/account/developer',
  fallbackError: 'Unable to revoke the pending transfer.',
  run: async ({ context, env, user }) => {
    const developer = await getDeveloperByOwner(env, user.sub);
    if (!developer) return '/account/developer';

    await createApiClient(env, user.sub).revokeTransfer(developer.id);
    await setFlash(context, env.sessionSecret, {
      title: 'Pending transfer link revoked.',
    });
  },
});
