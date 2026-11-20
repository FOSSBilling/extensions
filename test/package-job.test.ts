import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForPackageJob } from '@/lib/package-job';
import type { PackageJob } from '@/lib/api/client';

const queued = {
  id: '44444444-4444-4444-8444-444444444444',
  extension_identifier: 'example',
  status: 'queued',
  artifact: null,
  error: null,
  created_at: '2026-11-20T12:00:00Z',
  updated_at: '2026-11-20T12:00:00Z',
} satisfies PackageJob;
const artifact = {
  id: '33333333-3333-4333-8333-333333333333',
} as NonNullable<PackageJob['artifact']>;
const ready = { ...queued, status: 'ready', artifact } satisfies PackageJob;

describe('package job polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('backs off to five seconds while polling the same job', async () => {
    const startedAt = Date.now();
    const pollTimes: number[] = [];
    const read = vi.fn(async () => {
      pollTimes.push(Date.now() - startedAt);
      return pollTimes.length === 6
        ? ready
        : { ...queued, status: 'processing' as const };
    });
    const result = waitForPackageJob(queued, read, { waitMs: 20_000 });
    await vi.runAllTimersAsync();
    expect(await result).toBe(artifact);
    expect(read.mock.calls).toEqual(pollTimes.map(() => [queued.id]));
    expect(pollTimes).toEqual([1000, 3000, 6000, 10000, 15000, 20000]);
  });

  it('uses the artifact from an already-ready job without polling', async () => {
    const read = vi.fn();
    expect(await waitForPackageJob(ready, read)).toBe(artifact);
    expect(read).not.toHaveBeenCalled();
  });

  it('stops polling when a queued job fails validation', async () => {
    const read = vi.fn().mockResolvedValue({
      ...queued,
      status: 'failed',
      error: {
        code: 'INVALID_PACKAGE',
        status: 422,
        message: 'Invalid archive',
      },
    });
    await Promise.all([
      expect(waitForPackageJob(queued, read)).rejects.toMatchObject({
        status: 422,
        code: 'INVALID_PACKAGE',
      }),
      vi.runAllTimersAsync(),
    ]);
    expect(read).toHaveBeenCalledOnce();
  });

  it('reports that the job is still processing when the wait budget expires', async () => {
    const read = vi.fn().mockResolvedValue(queued);
    await Promise.all([
      expect(
        waitForPackageJob(queued, read, { waitMs: 3000 }),
      ).rejects.toMatchObject({
        code: 'PACKAGE_PROCESSING',
      }),
      vi.runAllTimersAsync(),
    ]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('retries a transient polling failure', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(ready);
    const result = waitForPackageJob(queued, read);
    await vi.runAllTimersAsync();
    expect(await result).toBe(artifact);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('stops after three consecutive transient polling failures', async () => {
    const offline = new TypeError('offline');
    const read = vi.fn().mockRejectedValue(offline);
    await Promise.all([
      expect(waitForPackageJob(queued, read)).rejects.toBe(offline),
      vi.runAllTimersAsync(),
    ]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('stops after the first access denial', async () => {
    const denied = Object.assign(new Error('Denied'), { status: 403 });
    const read = vi.fn().mockRejectedValue(denied);
    await Promise.all([
      expect(waitForPackageJob(queued, read)).rejects.toBe(denied),
      vi.runAllTimersAsync(),
    ]);
    expect(read).toHaveBeenCalledOnce();
  });
});
