import type {
  PackagingJob as PackageJob,
  PackageArtifact,
} from '@/lib/api/generated/extensions-v2';

export class PackageJobError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function waitForPackageJob(
  initial: PackageJob,
  read: (id: string) => Promise<PackageJob>,
  options: {
    waitMs?: number;
    progress?: (job: PackageJob) => void;
  } = {},
): Promise<PackageArtifact> {
  let job = initial;
  let failures = 0;
  let remaining = options.waitMs ?? 120_000;
  let interval = 1000;
  for (;;) {
    options.progress?.(job);
    if (job.status === 'ready') {
      if (job.artifact) return job.artifact;
      throw new PackageJobError(
        502,
        'PACKAGE_UNAVAILABLE',
        'The prepared package is unavailable. Please try again.',
      );
    }
    if (job.status === 'failed')
      throw new PackageJobError(
        job.error?.status ?? 422,
        job.error?.code ?? 'PACKAGE_FAILED',
        job.error?.message ?? 'Package preparation failed.',
      );
    if (remaining <= 0) break;
    const delay = Math.min(interval, remaining);
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    remaining -= delay;
    interval = Math.min(interval + 1000, 5000);
    try {
      job = await read(job.id);
      failures = 0;
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'status' in error
          ? error.status
          : undefined;
      if (
        (status !== undefined &&
          status !== 429 &&
          !(typeof status === 'number' && status >= 500)) ||
        ++failures >= 3
      )
        throw error;
    }
  }
  throw new PackageJobError(
    503,
    'PACKAGE_PROCESSING',
    'Package processing has not finished. Please try again shortly.',
  );
}
