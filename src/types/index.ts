import { gt, lt } from 'semver';

import type {
  Developer,
  DeveloperClaim,
  DeveloperHistoryEntry,
  DeveloperProfile,
  DeveloperTransfer,
  Extension,
  ExtensionListItem,
  ExtensionPayload,
  PendingDeveloperClaim,
  Release,
  Repository,
  Submission,
  SubmissionPayload,
} from '@/generated/extensions-v2';

export type {
  Developer,
  DeveloperClaim,
  DeveloperHistoryEntry,
  DeveloperProfile,
  DeveloperTransfer,
  Extension,
  ExtensionListItem,
  ExtensionPayload,
  PendingDeveloperClaim,
  Release,
  Repository,
  Submission,
  SubmissionPayload,
};

export const EXTENSION_TYPES = [
  'mod',
  'theme',
  'payment-gateway',
  'server-manager',
  'domain-registrar',
  'hook',
  'translation',
] as const;

export const SOURCE_TYPES = ['github', 'gitlab', 'custom'] as const;

export const DEVELOPER_TYPES = ['user', 'organization'] as const;

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

// Body for PUT /extensions/v2/developers/me — everything but the server-set
// `approved` flag, `content_revision`, GitHub verification fields, and
// owner-identity fields (only ever populated by the moderator list query).
export type DeveloperProfileInput = Omit<
  DeveloperProfile,
  | 'approved'
  | 'unclaimed'
  | 'content_revision'
  | 'github_org_verified'
  | 'github_verification_note'
  | 'github_verified_at'
  | 'github_url_verified'
  | 'owner_name'
  | 'owner_github_login'
>;

// What getDeveloperById (the public /developer/[id] read) returns —
// contact_email is owner/moderator-only, content_revision is an internal
// moderation concern, and github_org_verified/github_verification_note are
// a moderator-review signal — all excluded at the type level rather than
// relying solely on the query not selecting them.
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

export type SubmissionStatus = Submission['status'];

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
