import { describe, expect, it, vi } from 'vitest';
import { completePackageUpload, packageFormData } from '@/lib/package-upload';

const MAX_PACKAGE_REQUEST_BYTES = 512 * 1024;
describe('package uploads', () => {
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
  it('sends the source bytes only to storage, then confirms with the directory', async () => {
    const source = new File(['zip'], 'source.zip');
    const reservation = {
      kind: 'upload' as const,
      id: 'upload-id',
      url: 'https://storage.test/zip?signature=test',
      headers: { 'Content-Type': 'application/zip' },
    };
    const job = { id: 'job', status: 'queued' };
    const request = vi.fn(async (url: string, init: RequestInit) => {
      if (url === reservation.url) {
        expect(init).toMatchObject({
          method: 'PUT',
          headers: reservation.headers,
          credentials: 'omit',
          redirect: 'error',
        });
        expect(init.body).toBe(source);
        return new Response(null);
      }
      expect(url).toBe('/api/package-uploads');
      expect(init.method).toBe('PUT');
      expect([...(init.body as FormData)]).toEqual([
        ['upload_id', reservation.id],
      ]);
      return Response.json({ result: job }, { status: 202 });
    });
    vi.stubGlobal('fetch', request);
    try {
      expect(await completePackageUpload(reservation, source)).toEqual(job);
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
