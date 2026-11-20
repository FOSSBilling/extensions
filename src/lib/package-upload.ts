import { ExtensionValidationError } from './extension-form';
import { MAX_SOURCE_BYTES } from './extension-package';
import { formString } from './form';
import { sha256Hex } from './hash';
import type { PackageJob } from './api/client';
import type { PackageReservation } from './api/generated/extensions-v2';

export const MAX_PACKAGE_REQUEST_BYTES = 512 * 1024;

export async function packageFormData(request: Request): Promise<FormData> {
  const reader = request.body?.getReader();
  if (!reader) throw new ExtensionValidationError('The upload is empty.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PACKAGE_REQUEST_BYTES) {
        await reader.cancel();
        throw new ExtensionValidationError(
          'Package metadata must be 512 KiB or smaller.',
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return await new Response(bytes, {
      headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' },
    }).formData();
  } catch {
    throw new ExtensionValidationError(
      'The upload could not be read. Please try again.',
    );
  }
}

export function packageSourceFields(form: FormData) {
  const sha256 = formString(form, 'source_sha256');
  const size = formString(form, 'source_bytes');
  if (!sha256 && !size) return null;
  const bytes = Number(size);
  if (bytes > MAX_SOURCE_BYTES)
    throw new ExtensionValidationError(
      'Source ZIPs must be 5 MiB or smaller.',
      413,
    );
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    !/^[a-f0-9]{64}$/.test(sha256)
  )
    throw new ExtensionValidationError('The source ZIP details are invalid.');
  return { bytes, sha256 };
}

export async function describePackageSource(form: FormData, source: File) {
  if (!source.size || !source.name.toLowerCase().endsWith('.zip'))
    throw new Error('Choose a ZIP file containing the extension source.');
  if (source.size > MAX_SOURCE_BYTES)
    throw new Error('Source ZIPs must be 5 MiB or smaller.');
  form.set('source_sha256', await sha256Hex(await source.arrayBuffer()));
  form.set('source_bytes', String(source.size));
}

async function uploadRequest<T>(
  method: 'POST' | 'PUT',
  body: FormData,
): Promise<T> {
  const response = await fetch('/api/package-uploads', {
    method,
    body,
    redirect: 'manual',
  });
  if (response.status === 0 || response.status === 302)
    throw new Error(
      'Your session has expired. Sign in again and retry the upload.',
    );
  const result = (await response.json()) as { result?: T; error?: string };
  if (!response.ok || !result.result)
    throw new Error(
      result.error || 'Unable to prepare the package. Please try again.',
    );
  return result.result;
}

export async function reservePackageUpload(source: File) {
  const form = new FormData();
  await describePackageSource(form, source);
  return uploadRequest<PackageReservation>('POST', form);
}

export async function completePackageUpload(
  reservation: PackageReservation,
  source?: File,
): Promise<PackageJob> {
  if (reservation.kind === 'job') return reservation.job;
  if (!source) throw new Error('Choose a source ZIP for this release.');
  let response: Response;
  try {
    response = await fetch(reservation.url, {
      method: 'PUT',
      headers: reservation.headers,
      body: source,
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new Error('Unable to upload the source ZIP. Please try again.');
  }
  if (!response.ok)
    throw new Error('Unable to upload the source ZIP. Please try again.');
  const form = new FormData();
  form.set('upload_id', reservation.id);
  return uploadRequest<PackageJob>('PUT', form);
}

export async function readPackageJob(id: string): Promise<PackageJob> {
  const url = new URL('/api/package-uploads', location.origin);
  url.searchParams.set('jobId', id);
  const response = await fetch(url, { redirect: 'manual' });
  if (response.status === 0 || response.status === 302)
    throw Object.assign(
      new Error('Your session has expired. Sign in again to continue.'),
      { status: 401 },
    );
  const body = (await response.json()) as { job?: PackageJob; error?: string };
  if (!response.ok || !body.job)
    throw Object.assign(
      new Error(
        body.error ||
          'Unable to read package status. Your processing job has been kept.',
      ),
      { status: response.status },
    );
  return body.job;
}
