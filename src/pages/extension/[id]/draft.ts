import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth-guard';
import {
  createApiClient,
  ApiRequestError,
  getApiErrorMessage,
} from '@/lib/api/client';
import { prepareExtensionDraft } from '@/lib/extension-draft-server';
import { rebuildLatestPackage } from '@/lib/extension-package';
import { ExtensionValidationError } from '@/lib/extension-form';
import { formString } from '@/lib/form';
import { setFlash } from '@/lib/flash';

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireUser(context, env);
  if (guard instanceof Response) return guard;
  const { id } = context.params;
  if (!id) return new Response(null, { status: 404 });
  const fail = (message: string, status = 422) =>
    Response.json(
      { error: message },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  try {
    const raw = formString(await context.request.formData(), 'draft');
    if (raw.length > 300_000) return fail('This draft is too large to submit.');
    let draft;
    try {
      draft = JSON.parse(raw);
    } catch {
      return fail('This draft could not be read.');
    }
    const api = createApiClient(env, guard.sub);
    const {
      base,
      payload: changed,
      pending,
    } = await prepareExtensionDraft(api, id, draft);
    if (JSON.stringify(changed) === JSON.stringify(base))
      return fail('There are no changes to submit.');
    const payload = await rebuildLatestPackage(api, id, changed);
    await prepareExtensionDraft(api, id, draft);
    if (pending) await api.replacePendingRevision(id, pending.id, payload);
    else await api.updateExtension(id, payload);
    await setFlash(context, env.sessionSecret, {
      title: pending
        ? 'Pending Submission Updated.'
        : 'Changes Submitted for Review.',
    });
    return Response.json(
      { success: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ExtensionValidationError)
      return fail(error.message, error.status);
    if (error instanceof ApiRequestError)
      return fail(getApiErrorMessage(error), error.status);
    return fail(
      'Unable to submit your changes. Your local draft has been kept. Please try again.',
      503,
    );
  }
};
