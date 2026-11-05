import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth-guard';
import { createApiClient } from '@/lib/api/client';
import { formAction } from '@/lib/form-action';
import { purgeDirectory } from '@/lib/cache-invalidate';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = formAction({
  guard: requireUser,
  // A failure lands back on the overview so the author can retry; the
  // success path below overrides this with the account overview.
  redirect: (context) => {
    const { id } = context.params;
    return id ? `/extension/${id}` : '/account';
  },
  fallbackError: 'Unable to withdraw extension.',
  run: async ({ context, env, user }) => {
    const { id } = context.params;
    if (!id) return '/account';

    await createApiClient(env, user.sub).withdrawExtension(id);
    purgeDirectory(context);
    await setFlash(context, env.sessionSecret, {
      title: 'Extension withdrawn.',
    });
    return '/account';
  },
});
