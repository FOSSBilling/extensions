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
