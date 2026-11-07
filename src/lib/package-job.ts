import type {
  PackageJob,
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
    attempts?: number;
    pause?: () => Promise<void>;
    progress?: (job: PackageJob) => void;
  } = {},
): Promise<PackageArtifact> {
  let job = initial;
  const attempts = options.attempts ?? 120;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    options.progress?.(job);
    if (job.status === 'ready' && job.artifact) return job.artifact;
    if (job.status === 'failed')
      throw new PackageJobError(
        job.error?.status ?? 422,
        job.error?.code ?? 'PACKAGE_FAILED',
        job.error?.message ?? 'Package preparation failed.',
      );
    if (attempt === attempts) break;
    await (options.pause?.() ??
      new Promise<void>((resolve) => setTimeout(resolve, 1000)));
    job = await read(job.id);
  }
  throw new PackageJobError(
    503,
    'PACKAGE_PROCESSING',
    'Your package is still processing. Your edits have been kept. Resume processing in a moment.',
  );
}
