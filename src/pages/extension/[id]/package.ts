import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth-guard';
import {
  createApiClient,
  ApiRequestError,
  getApiErrorMessage,
} from '@/lib/api/client';
import { prepareExtensionDraft } from '@/lib/extension-draft-server';
import { releaseFromFields } from '@/lib/extension-draft';
import { packageManifest } from '@/lib/extension-package';
import { ExtensionValidationError } from '@/lib/extension-form';
import { packageFormData, sourceFile } from '@/lib/package-upload';
import { latestRelease } from '@/lib/releases';
import { formString } from '@/lib/form';

export const POST: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireUser(context, env);
  if (guard instanceof Response) return guard;
  const id = context.params.id;
  if (!id) return new Response(null, { status: 404 });
  const headers = { 'Cache-Control': 'private, no-store' };
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
    const api = createApiClient(env, guard.sub);
    const { payload } = await prepareExtensionDraft(api, id, draft);
    const original = payload.releases.find(
      (release) => release.tag === fields.original_tag,
    );
    if (fields.original_tag && !original)
      throw new ExtensionValidationError(
        'This release was removed. Close the editor and choose another release.',
        409,
      );
    if (original && fields.version_tag !== original.tag)
      throw new ExtensionValidationError(
        'Add a new release to use a different version.',
      );
    const release = releaseFromFields(fields, original ?? { download_url: '' });
    if (
      payload.releases.some(
        (item) =>
          item.tag.replace(/^v/, '') === release.tag.replace(/^v/, '') &&
          item !== original,
      )
    )
      throw new ExtensionValidationError(
        'A release with this version already exists.',
      );
    if (!original && payload.releases.length >= 100)
      throw new ExtensionValidationError('Keep at most 100 releases.');
    const source = sourceFile(form, !original?.artifact_id);
    const stored =
      !source && original?.artifact_id
        ? await api.getPackage(original.artifact_id)
        : undefined;
    const manifest =
      stored && original?.tag !== latestRelease(payload.releases)?.tag
        ? { ...stored.manifest, requires: release.requires }
        : packageManifest(id, payload, release);
    const job = await api.queuePackage(
      manifest,
      source ?? { sourceId: stored!.source_id },
    );
    return Response.json({ release, job }, { headers, status: 202 });
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

export const GET: APIRoute = async (context) => {
  const env = context.locals.env;
  const guard = await requireUser(context, env);
  if (guard instanceof Response) return guard;
  const jobId = context.url.searchParams.get('jobId');
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!jobId || !/^[a-f0-9-]{36}$/.test(jobId))
    return Response.json(
      { error: 'Invalid package job.' },
      { status: 400, headers },
    );
  try {
    const job = await createApiClient(env, guard.sub).getPackageJob(jobId);
    if (job.extension_identifier !== context.params.id)
      return Response.json(
        { error: 'Package job not found.' },
        { status: 404, headers },
      );
    return Response.json({ job }, { headers });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ApiRequestError
            ? getApiErrorMessage(error)
            : 'Unable to read package processing status.',
      },
      {
        status: error instanceof ApiRequestError ? error.status : 503,
        headers,
      },
    );
  }
};
