import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth-guard';
import { createApiClient } from '@/lib/api/client';
import { formAction } from '@/lib/form-action';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = formAction({
  guard: requireUser,
  redirect: '/account',
  fallbackError: 'Unable to cancel claim.',
  run: async ({ context, env, user }) => {
    const { id } = context.params;
    if (!id) return '/account';

    await createApiClient(env, user.sub).cancelClaim(id);
    await setFlash(context, env.sessionSecret, { title: 'Claim Cancelled.' });
  },
});
