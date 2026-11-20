import type {
  ExtensionUpdate,
  PackageArtifact,
  createApiClient,
} from '@/lib/api/client';
import { packageDownloadPath } from './package-download';
import { latestRelease } from './releases';
import type { Release } from '@/types';

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

export function artifactRelease(
  details: Pick<Release, 'date' | 'changelog_url'>,
  artifact: PackageArtifact,
): Release {
  return {
    ...details,
    tag: artifact.manifest.version,
    artifact_id: artifact.id,
    sha256: artifact.sha256,
    download_url: artifact.download_url,
    requires: artifact.manifest.requires,
  };
}

export function releaseDownloadHref(
  release: Pick<Release, 'download_url' | 'artifact_id'>,
): string {
  return packageDownloadPath(release.artifact_id) ?? release.download_url;
}

export async function applyLatestPackageManifest(
  api: Pick<ReturnType<typeof createApiClient>, 'getPackage'>,
  content: ExtensionUpdate,
  previous: ExtensionUpdate,
): Promise<ExtensionUpdate> {
  const latest = latestRelease(content.releases);
  if (
    !latest?.artifact_id ||
    latest.artifact_id === latestRelease(previous.releases)?.artifact_id
  )
    return content;
  const { manifest } = await api.getPackage(latest.artifact_id);
  return {
    ...content,
    manifest_version: manifest.manifest_version,
    name: manifest.name,
    type: manifest.type,
    author: manifest.author,
    license: manifest.license,
    homepage_url: manifest.homepage_url,
    requires: manifest.requires,
    version: manifest.version,
  };
}
