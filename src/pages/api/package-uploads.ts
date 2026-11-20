import type { APIRoute } from 'astro';
import {
  createApiClient,
  ApiRequestError,
  getApiErrorMessage,
  type Manifest,
} from '@/lib/api/client';
import { getSessionUser } from '@/lib/session';
import { formString } from '@/lib/form';
import { ExtensionValidationError } from '@/lib/extension-form';
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
    const form = await packageFormData(context.request);
    const api = createApiClient(env, user.sub);
    if (context.request.method === 'PUT') {
      const job = await api.confirmPackage(formString(form, 'upload_id'));
      return Response.json({ result: job }, { status: 202, headers });
    }
    const source = packageSourceFields(form);
    if (!source)
      throw new ExtensionValidationError(
        'Choose a source ZIP for this release.',
      );
    let manifest: Manifest;
    try {
      manifest = JSON.parse(formString(form, 'manifest'));
    } catch {
      throw new ExtensionValidationError('Unable to read package metadata.');
    }
    const result = await api.reservePackage(manifest, source);
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
