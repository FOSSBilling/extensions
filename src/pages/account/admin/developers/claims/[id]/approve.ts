import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient } from '@/lib/api/client';
import { formAction } from '@/lib/form-action';
import { formFlag, formString } from '@/lib/form';
import { purgeCatalogue } from '@/lib/cache-invalidate';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = formAction<{ notify: boolean }>({
  guard: requireModerator,
  redirect: '/account/admin/developers/claims',
  fallbackError: 'Unable to approve claim.',
  // The dialog posts an intent-gated notify choice; a missing or unreadable
  // body keeps the API's default of sending.
  required: false,
  fallback: { notify: true },
  parse: (form) => ({
    notify:
      formString(form, 'intent') === 'approve'
        ? formFlag(form, 'notify')
        : true,
  }),
  run: async ({ context, env, user, input }) => {
    const { id } = context.params;
    if (!id) return '/account/admin/developers/claims';

    const result = await createApiClient(env, user.sub).approveClaim(
      id,
      input.notify,
    );
    purgeCatalogue(context);
    if (input.notify && !result.notified) {
      await setFlash(context, env.sessionSecret, {
        category: 'warning',
        title: 'Claim approved, but the claimant could not be emailed.',
      });
    }
  },
});
