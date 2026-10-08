import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient } from '@/lib/api/client';
import { formAction } from '@/lib/form-action';
import { formFlag, formString } from '@/lib/form';
import { purgeCatalogue } from '@/lib/cache-invalidate';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = formAction<{
  expectedRevision: number;
  expectedGeneration: string;
  notify: boolean;
}>({
  guard: requireModerator,
  redirect: '/account/admin/developers',
  fallbackError: 'Unable to approve profile.',
  parse: (form) => {
    const expectedRevision = Number(formString(form, 'expected_revision'));
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return 'Missing or invalid profile revision.';
    }
    const expectedGeneration = formString(form, 'expected_generation');
    if (!/^[0-9a-f]{32}$/.test(expectedGeneration)) {
      return 'Missing or invalid profile revision.';
    }
    return {
      expectedRevision,
      expectedGeneration,
      notify: formFlag(form, 'notify'),
    };
  },
  run: async ({ context, env, user, input }) => {
    const { id } = context.params;
    if (!id) return '/account/admin/developers';

    const result = await createApiClient(env, user.sub).approveDeveloper(
      id,
      input.expectedRevision,
      input.expectedGeneration,
      input.notify,
    );
    purgeCatalogue(context);
    if (input.notify && !result.notified) {
      await setFlash(context, env.sessionSecret, {
        category: 'warning',
        title: 'Profile approved, but the owner could not be emailed.',
      });
    }
  },
});
