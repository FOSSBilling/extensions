import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient } from '@/lib/api/client';
import { formAction } from '@/lib/form-action';
import { formFlag, formString } from '@/lib/form';
import { purgeCatalogue } from '@/lib/cache-invalidate';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = formAction<{
  reviewNote: string;
  notify: boolean;
}>({
  guard: requireModerator,
  redirect: '/account/admin/revisions',
  fallbackError: 'Unable to reject revision.',
  parse: (form) => {
    const reviewNote = formString(form, 'review_note');
    if (!reviewNote) return 'A reason is required to reject a revision.';
    return { reviewNote, notify: formFlag(form, 'notify') };
  },
  run: async ({ context, env, user, input }) => {
    const { id, revisionId } = context.params;
    if (!id || !revisionId) return '/account/admin/revisions';

    const result = await createApiClient(env, user.sub).rejectRevision(
      id,
      revisionId,
      input.reviewNote,
      input.notify,
    );
    purgeCatalogue(context);
    if (input.notify && !result.notified) {
      await setFlash(context, env.sessionSecret, {
        category: 'warning',
        title: 'Revision rejected, but the author could not be emailed.',
      });
    }
  },
});
