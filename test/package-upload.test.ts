import { describe, expect, it, vi } from 'vitest';
import { packageFormData } from '@/lib/package-upload';
import { MAX_PACKAGE_REQUEST_BYTES } from '@/lib/extension-package';
describe('bounded package form uploads', () => {
  it('rejects and cancels a streamed request above the whole-request limit', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_PACKAGE_REQUEST_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    const request = new Request('https://site.test/extension/example/package', {
      method: 'POST',
      body,
      ...{ duplex: 'half' },
    });
    await expect(packageFormData(request)).rejects.toMatchObject({
      status: 413,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
