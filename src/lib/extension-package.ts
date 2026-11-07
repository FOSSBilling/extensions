import type {
  ExtensionUpdate,
  Manifest,
  PackageArtifact,
  createApiClient,
} from '@/lib/api/client';
import { packageDownloadPath } from './package-download';
import { latestRelease } from './releases';
import type { Release } from '@/types';

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_PACKAGE_REQUEST_BYTES = 6 * 1024 * 1024;

export function packageManifest(
  id: string,
  content: ExtensionUpdate,
  release = latestRelease(content.releases),
): Manifest {
  return {
    manifest_version: 1,
    id: id.toLowerCase(),
    type: content.type,
    name: content.name,
    description: content.description,
    author: content.author,
    license: content.license,
    homepage_url: content.homepage_url,
    version: (release?.tag ?? content.version).replace(/^v(?=\d)/, ''),
    requires: release?.requires ?? content.requires,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function artifactRelease(
  release: Release,
  artifact: PackageArtifact,
): Release {
  return {
    ...release,
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

// Only manifest-backed changes rebuild the latest artifact. Directory-only
// edits (README/source links/dates/changelogs) preserve the original package.
export async function rebuildLatestPackage(
  api: Pick<ReturnType<typeof createApiClient>, 'getPackage' | 'buildPackage'>,
  id: string,
  content: ExtensionUpdate,
): Promise<ExtensionUpdate> {
  const latest = latestRelease(content.releases);
  if (!latest?.artifact_id) return content;
  const previous = await api.getPackage(latest.artifact_id);
  const manifest = packageManifest(id, content, latest);
  if (canonical(previous.manifest) === canonical(manifest)) return content;
  const artifact = await api.buildPackage(manifest, {
    sourceId: previous.source_id,
  });
  return {
    ...content,
    releases: content.releases.map((release) =>
      release === latest ? artifactRelease(release, artifact) : release,
    ),
    download_url: artifact.download_url,
  };
}
