import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient } from '@/lib/api/client';
import { formAction } from '@/lib/form-action';
import { formFlag, formString } from '@/lib/form';
import { purgeCatalogue } from '@/lib/cache-invalidate';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = formAction<{ notify: boolean }>({
  guard: requireModerator,
  redirect: '/account/admin/revisions',
  fallbackError: 'Unable to approve revision.',
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
    const { id, revisionId } = context.params;
    if (!id || !revisionId) return '/account/admin/revisions';

    const result = await createApiClient(env, user.sub).approveRevision(
      id,
      revisionId,
      undefined,
      input.notify,
    );
    purgeCatalogue(context);
    if (input.notify && !result.notified) {
      await setFlash(context, env.sessionSecret, {
        category: 'warning',
        title: 'Revision approved, but the author could not be emailed.',
      });
    }
  },
});
