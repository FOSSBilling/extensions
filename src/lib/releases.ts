import prerelease from 'semver/functions/prerelease.js';
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
  const selected = releases.find((release) => release.is_latest === true);
  if (selected) return selected;
  const stable = releases.filter(
    (release) => valid(release.tag) && prerelease(release.tag) === null,
  );
  return (stable.length ? stable : releases).reduce<Release | undefined>(
    (latest, release) =>
      !latest || compareReleases(release, latest) < 0 ? release : latest,
    undefined,
  );
}

export function releasesDescending(releases: readonly Release[]): Release[] {
  return [...releases].sort(compareReleases);
}

export function selectLatestRelease(
  releases: readonly Release[],
  tag: string,
): Release[] {
  if (!releases.some((release) => release.tag === tag))
    throw new Error('Choose an existing release.');
  return releases.map(({ is_latest: _selected, ...release }) =>
    release.tag === tag ? { ...release, is_latest: true } : release,
  );
}

export function defaultLatestForVersion(tag: string): boolean {
  return Boolean(valid(tag)) && prerelease(tag) === null;
}
