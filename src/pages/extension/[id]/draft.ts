import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth-guard';
import {
  createApiClient,
  ApiRequestError,
  getApiErrorMessage,
} from '@/lib/api/client';
import {
  applyExtensionDraft,
  editableContent,
  reconstructionContent,
} from '@/lib/extension-draft';
import { ExtensionValidationError } from '@/lib/extension-form';
import { sha256Hex } from '@/lib/hash';
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
    const owned = await api.getMyExtension(id);
    const pending = owned.pending_revision;
    if ((draft?.pendingRevisionId ?? null) !== (pending?.id ?? null))
      return fail(
        'The pending submission changed or was reviewed. Your local draft has been kept. Reload the overview before editing again.',
        409,
      );
    const previous =
      !pending && !owned.published && owned.last_review
        ? await api.getRevision(id, owned.last_review.revision_id)
        : null;
    const stored = pending?.content ?? owned.published ?? previous?.content;
    const base =
      editableContent(stored) ??
      (pending || !owned.published ? reconstructionContent(stored) : null);
    if (!base)
      return fail(
        'The original content is unavailable. Your local draft has been kept.',
        409,
      );
    if (draft?.baselineHash !== (await sha256Hex(JSON.stringify(base))))
      return fail(
        'This extension changed since you started editing. Your local draft has been kept. Reload the overview to review it.',
        409,
      );
    const payload = applyExtensionDraft(base, draft);
    if (JSON.stringify(payload) === JSON.stringify(base))
      return fail('There are no changes to submit.');
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
    if (error instanceof ExtensionValidationError) return fail(error.message);
    if (error instanceof ApiRequestError)
      return fail(getApiErrorMessage(error), error.status);
    return fail(
      'Unable to submit your changes. Your local draft has been kept. Please try again.',
      503,
    );
  }
};
