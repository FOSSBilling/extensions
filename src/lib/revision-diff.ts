import type {
  ExtensionContent,
  Release,
  StoredExtensionContent,
} from '@/lib/api/generated/extensions-v2/types.gen';
import { repositoryURL } from '@/types';

// Fields moderators actually compare, in review order. `releases` and
// `readme` are handled specially (counts / collapsible) by the card UI but
// still appear here so "unchanged" state is explicit.
const DIFF_FIELDS = [
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

export interface RevisionDiffRow {
  field: DiffField;
  label: string;
  oldValue: string | null;
  newValue: string | null;
  // Link targets for values that aren't URLs themselves. Currently only the
  // source row carries these (built with repositoryURL so GitLab/custom
  // sources link correctly instead of assuming GitHub). Renderers must still
  // validate the scheme before linking.
  oldUrl: string | null;
  newUrl: string | null;
  changed: boolean;
  isNew: boolean;
}

const FIELD_LABELS: Record<DiffField, string> = {
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

function licenseLabel(
  license: ExtensionContent['license'] | StoredExtensionContent['license'],
): string | null {
  if (!license) return null;
  if (typeof license.name === 'string' && license.name.length > 0) {
    return license.spdx_id
      ? `${license.name} (${license.spdx_id})`
      : license.name;
  }
  return null;
}

function sourceLabel(
  source: ExtensionContent['source'] | StoredExtensionContent['source'],
): string | null {
  if (!source || typeof source.repo !== 'string') return null;
  return source.repo.length > 0 ? source.repo : null;
}

function sourceUrl(
  source: ExtensionContent['source'] | StoredExtensionContent['source'],
): string | null {
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
  return repositoryURL(source);
}

function releasesLabel(
  releases: ExtensionContent['releases'] | StoredExtensionContent['releases'],
): string | null {
  if (!releases) return null;
  if (releases.length === 0) return '—';
  const tags = releases
    .map((r: Release) => r?.tag)
    .filter((t: unknown): t is string => typeof t === 'string' && t.length > 0);
  if (tags.length === 0) return `${releases.length} release(s)`;
  const shown = tags.slice(0, 5).join(', ');
  return tags.length > 5
    ? `${releases.length} releases (${shown}, …)`
    : `${releases.length} release(s): ${shown}`;
}

function scalarLabel(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function fieldValues(
  field: DiffField,
  published: Partial<ExtensionContent> | null,
  revision: StoredExtensionContent,
): { oldValue: string | null; newValue: string | null } {
  switch (field) {
    case 'license':
      return {
        oldValue: published ? licenseLabel(published.license) : null,
        newValue: licenseLabel(revision.license),
      };
    case 'source':
      return {
        oldValue: published ? sourceLabel(published.source) : null,
        newValue: sourceLabel(revision.source),
      };
    case 'releases':
      return {
        oldValue: published ? releasesLabel(published.releases) : null,
        newValue: releasesLabel(revision.releases),
      };
    default:
      return {
        oldValue: published ? scalarLabel(published[field]) : null,
        newValue: scalarLabel(revision[field]),
      };
  }
}

export function diffRevisionContent(
  published: Partial<ExtensionContent> | null,
  revision: StoredExtensionContent,
): RevisionDiffRow[] {
  const isNew = published === null;
  return DIFF_FIELDS.map((field) => {
    const { oldValue, newValue } = fieldValues(field, published, revision);
    const isSource = field === 'source';
    return {
      field,
      label: FIELD_LABELS[field],
      oldValue,
      newValue,
      oldUrl: isSource ? sourceUrl(published?.source) : null,
      newUrl: isSource ? sourceUrl(revision.source) : null,
      changed: isNew ? newValue !== null : oldValue !== newValue,
      isNew,
    };
  });
}

export function countChangedRows(rows: RevisionDiffRow[]): number {
  return rows.filter((r) => r.changed).length;
}
