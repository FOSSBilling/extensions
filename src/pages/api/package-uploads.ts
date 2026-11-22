import type { APIRoute } from 'astro';
import {
  createApiClient,
  ApiRequestError,
  getApiErrorMessage,
} from '@/lib/api/client';
import { getSessionUser } from '@/lib/session';
import { formString } from '@/lib/form';
import { ExtensionValidationError, formUrl } from '@/lib/extension-form';
import { packageFormData, packageSourceFields } from '@/lib/package-upload';

const handle: APIRoute = async (context) => {
  const env = context.locals.env;
  const headers = { 'Cache-Control': 'private, no-store' };
  const user = await getSessionUser(context.cookies, env.sessionSecret);
  if (!user)
    return Response.json(
      {
        error: 'Your session has expired. Sign in again and retry the upload.',
      },
      { status: 401, headers },
    );
  try {
    const api = createApiClient(env, user.sub);
    if (context.request.method === 'GET') {
      const id = context.url.searchParams.get('jobId');
      if (!id) throw new ExtensionValidationError('Invalid package job.', 400);
      return Response.json({ job: await api.getPackageJob(id) }, { headers });
    }
    const form = await packageFormData(context.request);
    if (context.request.method === 'PUT') {
      const githubUrl = formUrl(
        form.get('github_url'),
        'GitHub Release ZIP URL',
        { optional: true, preserveScheme: true },
      );
      const uploadId = formString(form, 'upload_id');
      if (Boolean(githubUrl) === Boolean(uploadId))
        throw new ExtensionValidationError('Choose one package source.');
      const job = githubUrl
        ? await api.importGitHubPackage(githubUrl, {})
        : await api.confirmPackage(uploadId);
      return Response.json({ result: job }, { status: 202, headers });
    }
    const source = packageSourceFields(form);
    if (!source)
      throw new ExtensionValidationError(
        'Choose a source ZIP for this release.',
      );
    const result = await api.reservePackage({}, source);
    return Response.json({ result }, { headers });
  } catch (error) {
    const message =
      error instanceof ApiRequestError
        ? getApiErrorMessage(error)
        : error instanceof ExtensionValidationError
          ? error.message
          : 'Unable to prepare the package. Please try again.';
    const status =
      error instanceof ApiRequestError ||
      error instanceof ExtensionValidationError
        ? error.status
        : 503;
    return Response.json({ error: message }, { status, headers });
  }
};

export const POST = handle;
export const PUT = handle;
export const GET = handle;
