import { describe, expect, it, vi } from 'vitest';
import { PackageJobError, waitForPackageJob } from '@/lib/package-job';
import type { PackageJob } from '@/lib/api/client';

const queued = {
  id: 'job',
  extension_identifier: 'example',
  status: 'queued',
  artifact: null,
  error: null,
  created_at: 'now',
  updated_at: 'now',
} satisfies PackageJob;
describe('package job polling', () => {
  it('waits through queued and processing states without repeating the upload', async () => {
    const artifact = { id: 'artifact' } as NonNullable<PackageJob['artifact']>;
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ...queued, status: 'processing' })
      .mockResolvedValueOnce({ ...queued, status: 'ready', artifact });
    const pause = vi.fn().mockResolvedValue(undefined);
    expect(await waitForPackageJob(queued, read, { pause })).toBe(artifact);
    expect(read.mock.calls).toEqual([['job'], ['job']]);
  });
  it('accepts completion on the last allowed poll', async () => {
    const artifact = { id: 'artifact' } as NonNullable<PackageJob['artifact']>;
    expect(
      await waitForPackageJob(
        queued,
        async () => ({ ...queued, status: 'ready', artifact }),
        { attempts: 1, pause: async () => {} },
      ),
    ).toBe(artifact);
  });
  it('reports a failed package without continuing to poll', async () => {
    const read = vi.fn();
    await expect(
      waitForPackageJob(
        {
          ...queued,
          status: 'failed',
          error: {
            code: 'INVALID_PACKAGE',
            status: 422,
            message: 'Invalid archive',
          },
        },
        read,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_PACKAGE',
      message: 'Invalid archive',
    });
    expect(read).not.toHaveBeenCalled();
  });
  it('bounds waiting while allowing the saved job to be resumed', async () => {
    const read = vi.fn().mockResolvedValue(queued);
    await expect(
      waitForPackageJob(queued, read, { attempts: 2, pause: async () => {} }),
    ).rejects.toBeInstanceOf(PackageJobError);
    expect(read).toHaveBeenCalledTimes(2);
    await expect(
      waitForPackageJob(queued, read, { attempts: 0 }),
    ).rejects.toMatchObject({ code: 'PACKAGE_PROCESSING' });
  });
});

it('retries transient polling failures without repeating the upload', async () => {
  const artifact = { id: 'artifact' } as NonNullable<PackageJob['artifact']>;
  const read = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce({ ...queued, status: 'ready', artifact });
  expect(await waitForPackageJob(queued, read, { pause: async () => {} })).toBe(
    artifact,
  );
  expect(read).toHaveBeenCalledTimes(2);
});
it('bounds transient retries and does not retry access denials', async () => {
  const offline = new TypeError('offline');
  const read = vi.fn().mockRejectedValue(offline);
  await expect(
    waitForPackageJob(queued, read, { pause: async () => {} }),
  ).rejects.toBe(offline);
  expect(read).toHaveBeenCalledTimes(3);
  const denied = Object.assign(new Error('Denied'), { status: 403 });
  read.mockReset().mockRejectedValue(denied);
  await expect(
    waitForPackageJob(queued, read, { pause: async () => {} }),
  ).rejects.toBe(denied);
  expect(read).toHaveBeenCalledTimes(1);
});
it('fails immediately if a ready response has no artifact', async () => {
  const read = vi.fn();
  await expect(
    waitForPackageJob({ ...queued, status: 'ready' }, read),
  ).rejects.toMatchObject({ code: 'PACKAGE_UNAVAILABLE', status: 502 });
  expect(read).not.toHaveBeenCalled();
});
