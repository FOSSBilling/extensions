import { latestRelease } from './releases';
import { packageDownloadPath } from './package-download';
import type { Release } from '@/types';
import { isDirectoryAssetUrl } from './image-url';

/** Package icons are discovered from fixed filenames by the package service. */
export function extensionIconUrl(extension: {
  icon_url?: string;
  releases?: Release[];
}): string | undefined {
  if (extension.icon_url && isDirectoryAssetUrl(extension.icon_url))
    return extension.icon_url;
  const packagePath = packageDownloadPath(
    latestRelease(extension.releases ?? [])?.artifact_id,
  );
  if (packagePath) return `${packagePath}/icon`;
  try {
    const url = new URL(extension.icon_url ?? '');
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
