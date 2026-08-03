import gt from 'semver/functions/gt';
import lt from 'semver/functions/lt';

export const EXTENSION_TYPES = [
  'mod',
  'theme',
  'payment-gateway',
  'server-manager',
  'domain-registrar',
  'hook',
  'translation',
] as const;

export type ExtensionType = (typeof EXTENSION_TYPES)[number];

export const SOURCE_TYPES = ['github', 'gitlab', 'custom'] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export const DEVELOPER_TYPES = ['user', 'organization'] as const;

export type DeveloperType = (typeof DEVELOPER_TYPES)[number];

export function isExtensionType(value: string | null): value is ExtensionType {
  return (
    value !== null && (EXTENSION_TYPES as readonly string[]).includes(value)
  );
}

export function isSourceType(value: string): value is SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

export function isDeveloperType(value: string): value is DeveloperType {
  return (DEVELOPER_TYPES as readonly string[]).includes(value);
}

// Local view/domain models used by D1-backed account pages and shared detail
// components. These intentionally do not depend on API transport DTOs.
export type Release = {
  tag: string;
  date: string;
  download_url: string;
  changelog_url?: string;
  min_fossbilling_version: string;
};

export type Repository = {
  type: SourceType;
  repo: string;
};

export type License = {
  name: string;
  URL?: string;
};

export type Developer = {
  id: string;
  type: DeveloperType;
  name: string;
  URL?: string;
  avatar_url?: string;
  contact_email?: string;
  approved?: boolean;
};

export type Extension = {
  id: string;
  type: ExtensionType;
  name: string;
  description: string;
  releases: Release[];
  website: string;
  license: License;
  icon_url?: string;
  readme: string;
  source: Repository;
  version: string;
  download_url: string;
  developer: Developer;
};

export type DeveloperProfile = Developer & {
  approved: boolean;
  content_revision: number;
  github_org_verified?: boolean;
  github_verification_note?: string;
  github_verified_at?: string | null;
  github_url_verified?: boolean;
  unclaimed?: boolean;
};

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
