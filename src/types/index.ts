import { gt, lt } from 'semver';

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

export const AUTHOR_TYPES = ['user', 'organization'] as const;

export type Extension = {
  id: string;
  type: (typeof EXTENSION_TYPES)[number];
  name: string;
  description: string;
  author: Author;
  releases: Release[];
  website: string;
  license: {
    name: string;
    URL?: string;
  };
  icon_url?: string;
  readme: string;
  source: Repository;
  version: string;
  download_url: string;
};

export type Repository = {
  type: (typeof SOURCE_TYPES)[number];
  repo: string;
};

export type Author = Organization | User;

export type Organization = {
  type: 'organization';
  name: string;
  id: Lowercase<string>;
  URL?: string;
};

export type User = {
  type: 'user';
  name: string;
  id: Lowercase<string>;
  URL?: string;
};

export type Release = {
  tag: string;
  date: string;
  download_url: string;
  changelog_url?: string;
  min_fossbilling_version: string;
};

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

// Shape sent to/from the api repo's v2 submissions endpoints
// (src/services/extensions/v2/interfaces.ts there). ExtensionPayload omits the
// joined `author` field of Extension — the author is submitted separately.
export type ExtensionPayload = Omit<Extension, 'author'>;

export type SubmissionPayload = {
  author: Author;
  extension: ExtensionPayload;
};

// The `authors` row plus a moderator-set trust flag — see the api repo's
// src/services/extensions/v2/interfaces.ts (AuthorProfileSchema). Developer
// profiles are written directly (PUT /extensions/v2/authors/me), not through
// the submission/moderation queue; `approved` is purely a badge, not a gate.
// bio/avatar_url are shown on the public /developer/[id] page; contact_email
// is never read by any public-facing query — it's for moderator/maintainer
// contact only, same trust level as a user's own email.
export type AuthorProfile = Author & {
  approved: boolean;
  bio?: string;
  avatar_url?: string;
  contact_email?: string;
  // Local-only: derived from `owner_user_id IS NULL` by getAuthorById's own
  // query, not part of the api repo's AuthorProfile response. Never set on
  // profiles read via the api client (upsertAuthorProfile, listUnapprovedAuthors,
  // listAllAuthors) — only on the public /developer/[id] read.
  unclaimed?: boolean;
};

// Body for PUT /extensions/v2/authors/me — everything but the server-set
// `approved` flag.
export type AuthorProfileInput = Omit<AuthorProfile, 'approved'>;

// A snapshot of an authors row as it existed right after one PUT /authors/me
// write — see the api repo's AuthorHistoryEntrySchema. Newest first from
// GET /extensions/v2/authors/{id}/history (moderator-only).
export type AuthorHistoryEntry = {
  author_id: string;
  type: (typeof AUTHOR_TYPES)[number];
  name: string;
  URL?: string;
  changed_by: string;
  changed_at: string;
};

// A request to own an unowned ("legacy") developer profile — see the api
// repo's AuthorClaimSchema. Created via POST /authors/{id}/claim, resolved
// by a moderator via approve/reject.
export type AuthorClaim = {
  id: string;
  author_id: string;
  claimant_id: string;
  status: 'pending' | 'approved' | 'rejected';
  note?: string;
  review_note?: string;
  reviewer_id?: string;
  created_at: string;
  reviewed_at?: string;
};

// AuthorClaim plus the claimed profile's own name/type, for the moderator
// queue (GET /authors/claims) so it doesn't need a separate lookup per row.
export type PendingAuthorClaim = AuthorClaim & {
  author_name: string;
  author_type: (typeof AUTHOR_TYPES)[number];
};

// Result of POST /authors/{id}/transfer — the raw token is only ever
// returned here, once. Never persisted or put in a URL; shown once to the
// initiating owner to share out-of-band.
export type AuthorTransfer = {
  token: string;
  expires_at: string;
};

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export type Submission = {
  id: string;
  extension_id: string | null;
  author_id: string;
  submitted_by: string;
  status: SubmissionStatus;
  payload: SubmissionPayload;
  reviewer_id: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

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
