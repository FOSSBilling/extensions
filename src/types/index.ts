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

export const DEVELOPER_TYPES = ['user', 'organization'] as const;

export type Extension = {
  id: string;
  type: (typeof EXTENSION_TYPES)[number];
  name: string;
  description: string;
  developer: Developer;
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

export type Developer = Organization | User;

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
// (src/services/extensions/v2/interfaces.ts there). ExtensionPayload omits
// the joined `developer` field of Extension — the developer is submitted
// separately.
export type ExtensionPayload = Omit<Extension, 'developer'>;

export type SubmissionPayload = {
  developer: Developer;
  extension: ExtensionPayload;
};

// The `developers` row plus a moderator-set trust flag — see the api repo's
// src/services/extensions/v2/interfaces.ts (DeveloperProfileSchema).
// Developer profiles are written directly (PUT /extensions/v2/developers/me),
// not through the submission/moderation queue; `approved` is purely a badge,
// not a gate. avatar_url is shown on the public /developer/[id] page;
// contact_email is never read by any public-facing query — it's for
// moderator/maintainer contact only, same trust level as a user's own email.
export type DeveloperProfile = Developer & {
  approved: boolean;
  avatar_url?: string;
  contact_email?: string;
  // Bumped by the api repo on every profile write; required by
  // POST /developers/{id}/approve as `expected_revision` so an approval
  // can't silently apply to a profile edited after it was reviewed.
  content_revision: number;
  // Local-only: derived from `owner_user_id IS NULL` by getDeveloperById's
  // own query, not part of the api repo's DeveloperProfile response. Never
  // set on profiles read via the api client (upsertDeveloperProfile,
  // listUnapprovedDevelopers, listAllDevelopers) — only on the public
  // /developer/[id] read.
  unclaimed?: boolean;
};

// Body for PUT /extensions/v2/developers/me — everything but the server-set
// `approved` flag and `content_revision` (bumped by the api repo itself).
export type DeveloperProfileInput = Omit<
  DeveloperProfile,
  'approved' | 'unclaimed' | 'content_revision'
>;

// What getDeveloperById (the public /developer/[id] read) returns —
// contact_email is owner/moderator-only and content_revision is an internal
// moderation concern, so both are excluded at the type level rather than
// relying solely on the query not selecting them.
export type PublicDeveloperProfile = Omit<
  DeveloperProfile,
  'contact_email' | 'content_revision'
>;

// A snapshot of a developers row as it existed right after one
// PUT /developers/me write — see the api repo's DeveloperHistoryEntrySchema.
// Newest first from GET /extensions/v2/developers/{id}/history
// (moderator-only).
export type DeveloperHistoryEntry = {
  developer_id: string;
  type: (typeof DEVELOPER_TYPES)[number];
  name: string;
  URL?: string;
  changed_by: string;
  changed_at: string;
};

// A request to own an unowned ("legacy") developer profile — see the api
// repo's DeveloperClaimSchema. Created via POST /developers/{id}/claim,
// resolved by a moderator via approve/reject.
export type DeveloperClaim = {
  id: string;
  developer_id: string;
  claimant_id: string;
  status: 'pending' | 'approved' | 'rejected';
  note?: string;
  review_note?: string;
  reviewer_id?: string;
  created_at: string;
  reviewed_at?: string;
  // Server-computed at claim time (api repo's claim()) — true when the
  // claimant's own linked GitHub identity was confirmed to match this
  // developer's GitHub org/username. Undefined when there was no verifiable
  // GitHub entity for this id, or the claimant had no linked GitHub identity
  // yet; both cases still require the moderator's own judgment call, same as
  // before this existed. A positive mismatch is rejected before a claim can
  // even be created, so this is never `false` in practice.
  github_org_verified?: boolean;
  github_verification_note?: string;
};

// DeveloperClaim plus the claimed profile's own name/type, for the moderator
// queue (GET /developers/claims) so it doesn't need a separate lookup per
// row.
export type PendingDeveloperClaim = DeveloperClaim & {
  developer_name: string;
  developer_type: (typeof DEVELOPER_TYPES)[number];
};

// Result of POST /developers/{id}/transfer — the raw token is only ever
// returned here, once. Never persisted or put in a URL; shown once to the
// initiating owner to share out-of-band.
export type DeveloperTransfer = {
  token: string;
  expires_at: string;
};

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export type Submission = {
  id: string;
  extension_id: string | null;
  developer_id: string;
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
