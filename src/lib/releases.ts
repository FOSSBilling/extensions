import valid from 'semver/functions/valid.js';
import rcompare from 'semver/functions/rcompare.js';
import type { Release } from '@/types';

function releaseTime(release: Release): number {
  const time = Date.parse(release.date);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function compareReleases(a: Release, b: Release): number {
  const aVersion = valid(a.tag);
  const bVersion = valid(b.tag);
  if (aVersion && bVersion) {
    const order = rcompare(aVersion, bVersion);
    if (order) return order;
  } else if (aVersion || bVersion) {
    return aVersion ? -1 : 1;
  }
  const aTime = releaseTime(a);
  const bTime = releaseTime(b);
  return aTime === bTime ? 0 : aTime > bTime ? -1 : 1;
}

export function latestRelease(
  releases: readonly Release[],
): Release | undefined {
  return releases.reduce<Release | undefined>(
    (latest, release) =>
      !latest || compareReleases(release, latest) < 0 ? release : latest,
    undefined,
  );
}

export function releasesDescending(releases: readonly Release[]): Release[] {
  return [...releases].sort(compareReleases);
}
