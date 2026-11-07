import { packageDownloadPath } from './package-download';
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

interface DiffSource {
  type?: string;
  repo?: string;
}

interface DiffLicense {
  name?: string;
  spdx_id?: string;
  URL?: string;
}

interface DiffRelease {
  tag?: string;
  download_url?: string;
  artifact_id?: string;
}

interface DiffContent {
  author?: { name?: string; url?: string } | null;
  license?: string | DiffLicense | null;
  source?: DiffSource | null;
  releases?: Array<DiffRelease | null> | null;
  [field: string]: unknown;
}

// Fields moderators actually compare, in review order. `releases` and
// `readme` are handled specially (collapsible) by the card UI but
// still appear here so "unchanged" state is explicit.
export const DIFF_FIELDS = [
  'name',
  'type',
  'version',
  'description',
  'manifest_version',
  'author',
  'requires',
  'homepage_url',
  'download_url',
  'source',
  'license',
  'releases',
  'readme',
] as const;

export type DiffField = (typeof DIFF_FIELDS)[number];

// Fields whose plain values render as clickable links. DiffValue.astro and
// the browser queue renderer both check this set.
export const URL_FIELDS: ReadonlySet<string> = new Set([
  'homepage_url',
  'download_url',
]);

// Plain-text diff values longer than this render truncated behind a
// Show More/Less toggle (TruncatedText.astro and the browser renderer).
export const TRUNCATE_AT = 400;
export const TRUNCATE_EXPAND_LABEL = 'Show More';
export const TRUNCATE_COLLAPSE_LABEL = 'Show Less';

// Class for capped scrollable markdown regions — MarkdownValue.astro and the
// browser renderer's readme cell must stay visually identical. `break-normal`:
// diff cells use break-all for long URLs, which markdown prose must not
// inherit.
export const MARKDOWN_SCROLL_CLASS =
  'markdown-body break-normal max-h-72 overflow-y-auto overscroll-contain';

export const FIELD_LABELS: Record<DiffField, string> = {
  name: 'Name',
  type: 'Type',
  version: 'Version',
  description: 'Description',
  manifest_version: 'Manifest Version',
  author: 'Package Author',
  requires: 'Requirements',
  homepage_url: 'Website',
  download_url: 'Download URL',
  source: 'Source Repo',
  license: 'License',
  releases: 'Releases',
  readme: 'Readme',
};

function scalarLabel(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function licenseLabel(license?: string | DiffLicense | null): string | null {
  if (!license) return null;
  if (typeof license === 'string') return license;
  if (typeof license.name === 'string' && license.name.length > 0) {
    return license.spdx_id
      ? `${license.name} (${license.spdx_id})`
      : license.name;
  }
  return null;
}

function licenseUrl(license?: string | DiffLicense | null): string | null {
  if (
    !license ||
    typeof license === 'string' ||
    typeof license.URL !== 'string'
  )
    return null;
  return license.URL.length > 0 ? license.URL : null;
}

function licenseCompareKey(
  license?: string | DiffLicense | null,
): string | null {
  if (!license) return null;
  if (typeof license === 'string') return JSON.stringify([license]);
  const parts = [license.name, license.spdx_id, license.URL].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  return parts.length > 0 ? JSON.stringify(parts) : null;
}

function sourceLabel(source?: DiffSource | null): string | null {
  if (!source || typeof source.repo !== 'string') return null;
  return source.repo.length > 0 ? source.repo : null;
}

function sourceCompareKey(source?: DiffSource | null): string | null {
  if (!source || typeof source.repo !== 'string' || source.repo.length === 0)
    return null;
  return typeof source.type === 'string' && source.type.length > 0
    ? JSON.stringify([source.type, source.repo])
    : JSON.stringify([source.repo]);
}

// Same mapping as repositoryURL (@/types), reimplemented here so the
// browser client doesn't pull semver into its bundle. Keeps GitLab/custom
// sources linking correctly.
function sourceHref(source?: DiffSource | null): string | null {
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

export function fieldDisplay(
  field: DiffField,
  content: DiffContent | null,
): string | null {
  if (!content) return null;
  switch (field) {
    case 'homepage_url':
      return scalarLabel(content.homepage_url ?? content.website);
    case 'author':
      return scalarLabel(content.author?.name);
    case 'requires':
      return content[field] == null ? null : canonicalJson(content[field]);
    case 'license':
      return licenseLabel(content.license);
    case 'source':
      return sourceLabel(content.source);
    case 'releases':
      return content.releases == null
        ? null
        : content.releases.length === 0
          ? '—'
          : canonicalJson(content.releases);
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
    case 'author':
      return content.author == null ? null : canonicalJson(content.author);
    case 'license':
      return licenseCompareKey(content.license);
    case 'source':
      return sourceCompareKey(content.source);
    case 'releases':
      return content.releases == null ? null : canonicalJson(content.releases);
    default:
      return fieldDisplay(field, content);
  }
}

// The one "changed" rule both renderers (server and browser) must agree on:
// a brand-new extension's rows count as changed whenever they carry a value;
// otherwise a field changed when its comparison keys differ.
export function fieldChanged(
  field: DiffField,
  published: DiffContent | null,
  revision: DiffContent | null,
  isNew: boolean,
): boolean {
  return isNew
    ? fieldDisplay(field, revision) !== null
    : fieldCompareKey(field, published) !== fieldCompareKey(field, revision);
}

export function fieldUrl(
  field: DiffField,
  content: DiffContent | null,
): string | null {
  if (!content) return null;
  switch (field) {
    case 'download_url': {
      const release = content.releases?.find(
        (release) =>
          release?.download_url === content.download_url &&
          release?.artifact_id,
      );
      return packageDownloadPath(release?.artifact_id);
    }
    case 'author':
      return scalarLabel(content.author?.url);
    case 'license':
      return licenseUrl(content.license);
    case 'source':
      return sourceHref(content.source);
    default:
      return null;
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .filter((key) => item[key] !== undefined)
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
