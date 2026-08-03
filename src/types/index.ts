import { gt, lt } from 'semver';
import type {
  Developer as ApiDeveloper,
  DeveloperProfile as ApiDeveloperProfile,
  Extension as ApiExtension,
  License as ApiLicense,
  Release as ApiRelease,
  Repository as ApiRepository,
} from '@/lib/api/generated/extensions-v2';

export const EXTENSION_TYPES = [
  'mod',
  'theme',
  'payment-gateway',
  'server-manager',
  'domain-registrar',
  'hook',
  'translation',
] as const satisfies readonly ApiExtension['type'][];

export const SOURCE_TYPES = [
  'github',
  'gitlab',
  'custom',
] as const satisfies readonly ApiRepository['type'][];

export const DEVELOPER_TYPES = [
  'user',
  'organization',
] as const satisfies readonly ApiDeveloper['type'][];

export type ExtensionType = ApiExtension['type'];
export type SourceType = ApiRepository['type'];
export type DeveloperType = ApiDeveloper['type'];

// Local view/domain models used by D1-backed account pages and shared detail
// components. API transport DTOs are intentionally exported by the API
// façade instead of this application-wide module.
export type Release = Pick<
  ApiRelease,
  'tag' | 'date' | 'download_url' | 'changelog_url' | 'min_fossbilling_version'
>;

export type Repository = Pick<ApiRepository, 'type' | 'repo'>;

export type License = Pick<ApiLicense, 'name' | 'URL'>;

export type Developer = Pick<
  ApiDeveloper,
  'id' | 'type' | 'name' | 'URL' | 'avatar_url' | 'contact_email'
> & {
  approved?: boolean;
};

export type Extension = Omit<ApiExtension, 'developer'> & {
  developer: Developer;
};

export type DeveloperProfile = Pick<
  ApiDeveloperProfile,
  | 'id'
  | 'type'
  | 'name'
  | 'URL'
  | 'avatar_url'
  | 'contact_email'
  | 'approved'
  | 'content_revision'
  | 'github_org_verified'
  | 'github_verification_note'
  | 'github_verified_at'
  | 'github_url_verified'
  | 'unclaimed'
  | 'owner_name'
  | 'owner_github_login'
>;

// What getDeveloperById (the public /developer/[id] read) returns — private
// owner and moderation fields are excluded from the local public view.
export type PublicDeveloperProfile = Omit<
  DeveloperProfile,
  | 'contact_email'
  | 'content_revision'
  | 'github_org_verified'
  | 'github_verification_note'
  | 'github_verified_at'
  | 'github_url_verified'
  | 'owner_name'
  | 'owner_github_login'
>;

export function getLatestRelease(extension: Extension): Release | undefined {
  if (extension.releases.length === 0) {
    return undefined;
  }

  let latestRelease = extension.releases[0];
  for (let i = 1; i < extension.releases.length; i++) {
    const release = extension.releases[i];

    if (gt(release.tag, latestRelease.tag)) {
      latestRelease = release;
    }
  }

  return latestRelease;
}

export function sortReleasesDescending(releases: Release[]): Release[] {
  return [...releases].sort((a, b) => {
    if (gt(a.tag, b.tag)) {
      return -1;
    } else if (lt(a.tag, b.tag)) {
      return 1;
    } else {
      return 0;
    }
  });
}

export function repositoryURL(repository: Repository): string {
  switch (repository.type) {
    case 'github':
      return `https://github.com/${repository.repo}`;
    case 'gitlab':
      return `https://gitlab.com/${repository.repo}`;
    case 'custom':
      return repository.repo;
  }
}
