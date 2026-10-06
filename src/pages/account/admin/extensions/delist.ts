import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient } from '@/lib/api/client';
import { formAction } from '@/lib/form-action';
import { formFlag, formString } from '@/lib/form';
import { purgeCatalogue } from '@/lib/cache-invalidate';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = formAction<{
  id: string;
  reason: string;
  notify: boolean;
}>({
  guard: requireModerator,
  redirect: '/account/admin/extensions',
  fallbackError: 'Unable to delist extension.',
  parse: (form) => {
    const id = formString(form, 'id');
    const reason = formString(form, 'reason');
    if (!id || !reason) {
      return 'An extension id and a reason are both required to delist.';
    }
    return { id, reason, notify: formFlag(form, 'notify') };
  },
  run: async ({ context, env, user, input }) => {
    const result = await createApiClient(env, user.sub).delistExtension(
      input.id,
      input.reason,
      input.notify,
    );
    purgeCatalogue(context);
    let description = 'The author has been emailed.';
    if (!input.notify) {
      description = 'The author was not emailed, as requested.';
    } else if (!result.notified) {
      description =
        'The author could not be emailed — no address on file or sending failed.';
    }
    await setFlash(context, env.sessionSecret, {
      category: 'success',
      title: `"${input.id}" removed from the catalogue.`,
      description,
    });
  },
});
