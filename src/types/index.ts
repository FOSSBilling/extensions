import { latestRelease, releasesDescending } from '@/lib/releases';
import SPDX_LICENSE_IDS from 'spdx-license-ids/index.json';

// SPDX identifiers offered as form suggestions; manifest licenses are strings.
export { SPDX_LICENSE_IDS };

export const EXTENSION_TYPES = [
  'module',
  'theme',
  'payment-gateway',
  'server-manager',
  'domain-registrar',
  'translation',
] as const;

export type ExtensionType = (typeof EXTENSION_TYPES)[number];

export const EXTENSION_TYPE_LABELS: Record<ExtensionType, string> = {
  module: 'Module',
  theme: 'Theme',
  'payment-gateway': 'Payment Gateway',
  'server-manager': 'Server Manager',
  'domain-registrar': 'Domain Registrar',
  translation: 'Translation',
};

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

// Local view/domain models used by API-backed account pages and shared detail
// components. These intentionally do not depend on API transport DTOs.
export type Requirements = {
  fossbilling: string;
  php: string;
  modules?: Record<string, string>;
};
export type PackageAuthor = { name: string; url?: string };
export type Release = {
  tag: string;
  date: string;
  download_url: string;
  changelog_url?: string;
  requires: Requirements;
};
export type Repository = { type: SourceType; repo: string };
export type License = string;

export type Developer = {
  id: string;
  type: DeveloperType;
  name: string;
  URL?: string;
  avatar_url?: string;
  approved?: boolean;
};

export type Extension = {
  manifest_version: 1;
  author: PackageAuthor;
  requires: Requirements;
  id: string;
  type: ExtensionType;
  name: string;
  description: string;
  releases: Release[];
  homepage_url?: string;
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
  contact_email?: string;
  content_revision: number;
  profile_generation: string;
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
  | 'profile_generation'
  | 'github_org_verified'
  | 'github_verification_note'
  | 'github_verified_at'
  | 'github_url_verified'
  | 'unclaimed'
> & { unclaimed: boolean };

export function getLatestRelease(extension: Extension): Release | undefined {
  return latestRelease(extension.releases);
}

export function sortReleasesDescending(releases: Release[]): Release[] {
  return releasesDescending(releases);
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
