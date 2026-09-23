import type { APIRoute } from 'astro';
import { requireModerator } from '@/lib/auth-guard';
import { createApiClient, ApiRequestError } from '@/lib/api/client';
import { getModerationExtensionDetail } from '@/lib/extensions-data';
import {
  buildExtensionUpdatePayload,
  ExtensionValidationError,
} from '@/lib/extension-form';
import { formString } from '@/lib/form';
import { purgeCatalogue } from '@/lib/cache-invalidate';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireModerator(context, env);
  if (guard instanceof Response) return guard;
  const user = guard;

  const { id } = context.params;
  if (!id) return context.redirect('/account/admin/extensions');
  const detailPath = `/account/admin/extensions/${id}`;

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    await setFlash(context, env.sessionSecret, {
      category: 'error',
      title: 'Malformed request.',
    });
    return context.redirect(`${detailPath}/edit`);
  }

  const correctionNote = formString(form, 'correction_note');
  if (!correctionNote) {
    await setFlash(context, env.sessionSecret, {
      category: 'error',
      title: 'A correction note (up to 2000 characters) is required.',
    });
    return context.redirect(`${detailPath}/edit`);
  }

  // The published content carries the releases, version, and download URL
  // through when the moderator adds no new release — same builder the author
  // edit page uses.
  const owned = await getModerationExtensionDetail(env, user.sub, id);
  if (!owned?.published) {
    await setFlash(context, env.sessionSecret, {
      category: 'error',
      title: 'Only a published extension can be corrected.',
    });
    return context.redirect(detailPath);
  }

  const api = createApiClient(env, user.sub);
  try {
    const payload = buildExtensionUpdatePayload(form, owned.published);
    await api.correctExtension(owned.id, payload, correctionNote);
    purgeCatalogue(context);
    await setFlash(context, env.sessionSecret, {
      category: 'success',
      title: `"${owned.id}" corrected.`,
      description:
        'Recorded as a moderator revision — the author sees it in history; no email was sent.',
    });
  } catch (e) {
    const message =
      e instanceof ApiRequestError || e instanceof ExtensionValidationError
        ? e.message
        : 'Unable to correct extension.';
    await setFlash(context, env.sessionSecret, {
      category: 'error',
      title: message,
    });
    return context.redirect(`${detailPath}/edit`);
  }

  return context.redirect(detailPath);
};
