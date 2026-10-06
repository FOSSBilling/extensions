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
  redirect: '/account/admin/developers/claims',
  fallbackError: 'Unable to reject claim.',
  parse: (form) => {
    const reviewNote = formString(form, 'review_note');
    if (!reviewNote) return 'A reason is required to reject a claim.';
    return { reviewNote, notify: formFlag(form, 'notify') };
  },
  run: async ({ context, env, user, input }) => {
    const { id } = context.params;
    if (!id) return '/account/admin/developers/claims';

    const result = await createApiClient(env, user.sub).rejectClaim(
      id,
      input.reviewNote,
      input.notify,
    );
    purgeCatalogue(context);
    if (input.notify && !result.notified) {
      await setFlash(context, env.sessionSecret, {
        category: 'warning',
        title: 'Claim rejected, but the claimant could not be emailed.',
      });
    }
  },
});
