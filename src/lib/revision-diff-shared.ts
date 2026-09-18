// Pure field registry + label/compare helpers shared by the server diff
// (revision-diff.ts) and the browser queue client
// (admin-revisions-client.ts). Zero runtime dependencies by design: the
// client bundle cannot import @/types (semver) or the API client, so
// everything here operates on minimal structural shapes that the generated
// content types already satisfy.
//
// Display labels and comparison keys are separate on purpose — a revision
// that changes only a link target (source host, license URL) must count as
// changed even though its visible text is identical. Link targets are
// returned raw; renderers still validate the scheme before linking.

export interface DiffSource {
  type?: string;
  repo?: string;
}

export interface DiffLicense {
  name?: string;
  spdx_id?: string;
  URL?: string;
}

export interface DiffRelease {
  tag?: string;
}

export interface DiffContent {
  license?: DiffLicense | null;
  source?: DiffSource | null;
  releases?: Array<DiffRelease | null> | null;
  [field: string]: unknown;
}

// Fields moderators actually compare, in review order. `releases` and
// `readme` are handled specially (counts / collapsible) by the card UI but
// still appear here so "unchanged" state is explicit.
export const DIFF_FIELDS = [
  'name',
  'type',
  'version',
  'description',
  'website',
  'download_url',
  'icon_url',
  'source',
  'license',
  'releases',
  'readme',
] as const;

export type DiffField = (typeof DIFF_FIELDS)[number];

export const FIELD_LABELS: Record<DiffField, string> = {
  name: 'Name',
  type: 'Type',
  version: 'Version',
  description: 'Description',
  website: 'Website',
  download_url: 'Download URL',
  icon_url: 'Icon URL',
  source: 'Source Repo',
  license: 'License',
  releases: 'Releases',
  readme: 'Readme',
};

export function scalarLabel(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function licenseLabel(license?: DiffLicense | null): string | null {
  if (!license) return null;
  if (typeof license.name === 'string' && license.name.length > 0) {
    return license.spdx_id
      ? `${license.name} (${license.spdx_id})`
      : license.name;
  }
  return null;
}

export function licenseUrl(license?: DiffLicense | null): string | null {
  if (!license || typeof license.URL !== 'string') return null;
  return license.URL.length > 0 ? license.URL : null;
}

export function licenseCompareKey(license?: DiffLicense | null): string | null {
  if (!license) return null;
  const parts = [license.name, license.spdx_id, license.URL].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  return parts.length > 0 ? JSON.stringify(parts) : null;
}

export function sourceLabel(source?: DiffSource | null): string | null {
  if (!source || typeof source.repo !== 'string') return null;
  return source.repo.length > 0 ? source.repo : null;
}

export function sourceCompareKey(source?: DiffSource | null): string | null {
  if (!source || typeof source.repo !== 'string' || source.repo.length === 0)
    return null;
  return typeof source.type === 'string' && source.type.length > 0
    ? JSON.stringify([source.type, source.repo])
    : JSON.stringify([source.repo]);
}

// Same mapping as repositoryURL (@/types), reimplemented here so the
// browser client doesn't pull semver into its bundle. Keeps GitLab/custom
// sources linking correctly.
export function sourceHref(source?: DiffSource | null): string | null {
  if (
    !source ||
    typeof source.repo !== 'string' ||
    source.repo.length === 0 ||
    (source.type !== 'github' &&
      source.type !== 'gitlab' &&
      source.type !== 'custom')
  ) {
    return null;
  }
  switch (source.type) {
    case 'github':
      return `https://github.com/${source.repo}`;
    case 'gitlab':
      return `https://gitlab.com/${source.repo}`;
    case 'custom':
      return source.repo;
  }
}

export function releasesLabel(
  releases?: Array<DiffRelease | null> | null,
): string | null {
  if (!releases) return null;
  if (releases.length === 0) return '—';
  const tags = releases
    .map((r) => r?.tag)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
  if (tags.length === 0) return `${releases.length} release(s)`;
  const shown = tags.slice(0, 5).join(', ');
  return tags.length > 5
    ? `${releases.length} releases (${shown}, …)`
    : `${releases.length} release(s): ${shown}`;
}

export function fieldDisplay(
  field: DiffField,
  content: DiffContent | null,
): string | null {
  if (!content) return null;
  switch (field) {
    case 'license':
      return licenseLabel(content.license);
    case 'source':
      return sourceLabel(content.source);
    case 'releases':
      return releasesLabel(content.releases);
    default:
      return scalarLabel(content[field]);
  }
}

export function fieldCompareKey(
  field: DiffField,
  content: DiffContent | null,
): string | null {
  if (!content) return null;
  switch (field) {
    case 'license':
      return licenseCompareKey(content.license);
    case 'source':
      return sourceCompareKey(content.source);
    default:
      return fieldDisplay(field, content);
  }
}

export function fieldUrl(
  field: DiffField,
  content: DiffContent | null,
): string | null {
  if (!content) return null;
  switch (field) {
    case 'license':
      return licenseUrl(content.license);
    case 'source':
      return sourceHref(content.source);
    default:
      return null;
  }
}
