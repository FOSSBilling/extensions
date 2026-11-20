import type { APIRoute } from 'astro';
import { getSessionUser } from '@/lib/session';
import {
  createApiClient,
  ApiRequestError,
  getApiErrorMessage,
} from '@/lib/api/client';
import { prepareExtensionDraft } from '@/lib/extension-draft-server';
import { releaseDetails } from '@/lib/extension-draft';
import { ExtensionValidationError } from '@/lib/extension-form';
import { packageFormData, packageSourceFields } from '@/lib/package-upload';
import { formString } from '@/lib/form';

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const headers = { 'Cache-Control': 'private, no-store' };
  const user = await getSessionUser(context.cookies, env.sessionSecret);
  if (!user)
    return Response.json(
      { error: 'Your session has expired. Sign in again to continue.' },
      { status: 401, headers },
    );
  const id = context.params.id;
  if (!id) return new Response(null, { status: 404 });
  try {
    const form = await packageFormData(context.request);
    let draft: unknown, fields: Record<string, string>;
    try {
      draft = JSON.parse(formString(form, 'draft'));
      fields = JSON.parse(formString(form, 'release'));
    } catch {
      throw new ExtensionValidationError('The release could not be read.');
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields))
      throw new ExtensionValidationError('The release could not be read.');
    const api = createApiClient(env, user.sub);
    const { payload, published } = await prepareExtensionDraft(api, id, draft);
    const original = payload.releases.find(
      (release) => release.tag === fields.original_tag,
    );
    if (fields.original_tag && !original)
      throw new ExtensionValidationError(
        'This release was removed. Close the editor and choose another release.',
        409,
      );
    if (!original && payload.releases.length >= 100)
      throw new ExtensionValidationError('Keep at most 100 releases.');
    const details = releaseDetails(fields);
    const source = packageSourceFields(form);
    if (!source) {
      if (!original?.artifact_id)
        throw new ExtensionValidationError('Choose a ZIP for this release.');
      return Response.json(
        { release: { ...original, ...details } },
        { headers },
      );
    }
    const version = original?.tag.replace(/^v(?=\d)/, '');
    if (
      version &&
      published?.releases.some(
        (release) =>
          release.artifact_id &&
          release.tag.replace(/^v(?=\d)/, '') === version,
      )
    )
      throw new ExtensionValidationError(
        'Published release ZIPs are locked. Upload a new version.',
        409,
      );
    const reservation = await api.reservePackage(
      { id: id.toLowerCase(), version },
      source,
    );
    return Response.json({ details, reservation }, { headers });
  } catch (error) {
    const message =
      error instanceof ApiRequestError
        ? getApiErrorMessage(error)
        : error instanceof ExtensionValidationError
          ? error.message
          : 'Unable to prepare this release. Your edits have been kept. Please try again.';
    const status =
      error instanceof ApiRequestError ||
      error instanceof ExtensionValidationError
        ? error.status
        : 503;
    return Response.json({ error: message }, { status, headers });
  }
};
