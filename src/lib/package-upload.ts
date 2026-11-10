import { ExtensionValidationError } from './extension-form';
import {
  MAX_PACKAGE_REQUEST_BYTES,
  MAX_SOURCE_BYTES,
} from './extension-package';

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
          'The upload is too large. Source ZIPs must be 5 MiB or smaller.',
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

export function sourceFile(form: FormData, required = false): File | undefined {
  const source = form.get('source');
  if (!(source instanceof File) || !source.size) {
    if (required)
      throw new ExtensionValidationError(
        'Choose a source ZIP for this release.',
      );
    return undefined;
  }
  if (source.size > MAX_SOURCE_BYTES)
    throw new ExtensionValidationError(
      'Source ZIPs must be 5 MiB or smaller.',
      413,
    );
  if (!source.name.toLowerCase().endsWith('.zip'))
    throw new ExtensionValidationError(
      'Choose a ZIP file containing the extension source.',
    );
  return source;
}
