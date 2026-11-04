import type { ExtensionUpdate } from '@/lib/api/client';
import {
  isExtensionType,
  isSourceType,
  SPDX_LICENSE_IDS,
  type Release,
} from '@/types';
import { OTHER_LICENSE, ExtensionValidationError } from './extension-form';
import { latestRelease } from './releases';
import { repositoryFromFields } from './repository';
import { withHttpsScheme } from './url-prefix';

export type DraftSection = 'listing' | 'readme' | 'details';
export interface ExtensionDraft {
  baselineHash: string;
  pendingRevisionId?: string;
  sections: Partial<Record<DraftSection, Record<string, string>>>;
  releases?: Release[];
}

// Escape the HTML script boundary without changing values after JSON.parse.
export function serializeDraftConfig(value: object): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

// Historical submissions can be incomplete. Only offer the editor when a
// complete baseline exists; never fill missing published fields with blanks.
export function editableContent(value: unknown): ExtensionUpdate | null {
  if (
    !record(value) ||
    !isExtensionType(typeof value.type === 'string' ? value.type : null)
  )
    return null;
  const strings = [
    'name',
    'description',
    'website',
    'readme',
    'version',
    'download_url',
  ] as const;
  if (
    strings.some((key) => typeof value[key] !== 'string') ||
    !Array.isArray(value.releases) ||
    !record(value.license) ||
    typeof value.license.name !== 'string' ||
    !record(value.source) ||
    !isSourceType(String(value.source.type)) ||
    typeof value.source.repo !== 'string'
  )
    return null;
  const content = value as unknown as ExtensionUpdate;
  return {
    type: content.type,
    name: content.name,
    description: content.description,
    website: content.website,
    icon_url: content.icon_url,
    readme: content.readme,
    license: content.license,
    source: content.source,
    releases: content.releases,
    version: content.version,
    download_url: content.download_url,
  };
}

// Compacted or pre-v2 rejected submissions can lack required fields. Owners
// can rebuild these sections in a draft rather than losing the extension ID.
export function reconstructionContent(value: unknown): ExtensionUpdate {
  const fields = record(value) ? value : {};
  const string = (key: string) =>
    typeof fields[key] === 'string' ? fields[key] : '';
  const type = string('type');
  return {
    type: isExtensionType(type) ? type : 'mod',
    name: string('name'),
    description: string('description'),
    website: string('website'),
    icon_url: string('icon_url') || undefined,
    readme: string('readme'),
    source:
      record(fields.source) &&
      isSourceType(String(fields.source.type)) &&
      typeof fields.source.repo === 'string'
        ? (fields.source as ExtensionUpdate['source'])
        : { type: 'github', repo: '' },
    license:
      record(fields.license) && typeof fields.license.name === 'string'
        ? (fields.license as ExtensionUpdate['license'])
        : { name: '' },
    releases: Array.isArray(fields.releases)
      ? (fields.releases as Release[])
      : [],
    version: string('version'),
    download_url: string('download_url'),
  };
}

function text(fields: Record<string, unknown>, key: string): string {
  return typeof fields[key] === 'string' ? fields[key].trim() : '';
}
function required(
  fields: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = text(fields, key);
  if (!value) throw new ExtensionValidationError(`${label} is required.`);
  return value;
}
function url(
  fields: Record<string, unknown>,
  key: string,
  label: string,
  optional = false,
): string | undefined {
  const raw = text(fields, key);
  if (!raw && optional) return undefined;
  const value = withHttpsScheme(raw);
  try {
    if (value && new URL(value).hostname) return value;
  } catch {
    /* Report the field below. */
  }
  throw new ExtensionValidationError(`Enter a valid ${label}.`);
}

export function releaseFromFields(fields: Record<string, unknown>): Release {
  const date = required(fields, 'release_date', 'Release date');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new ExtensionValidationError('Enter a valid release date.');
  return {
    tag: required(fields, 'version_tag', 'Version tag'),
    date,
    download_url: url(fields, 'download_url', 'download URL')!,
    changelog_url: url(fields, 'changelog_url', 'changelog URL', true),
    min_fossbilling_version: required(
      fields,
      'min_fossbilling_version',
      'Minimum FOSSBilling version',
    ),
  };
}

function applySourceAndLicense(
  result: ExtensionUpdate,
  raw: Record<string, unknown>,
): void {
  const source = repositoryFromFields(raw);
  if (!source)
    throw new ExtensionValidationError(
      'Enter a valid HTTP or HTTPS Source URL.',
    );
  result.source = source;
  const spdx = text(raw, 'license_spdx_id');
  if (spdx !== OTHER_LICENSE && !SPDX_LICENSE_IDS.includes(spdx))
    throw new ExtensionValidationError('Choose a valid license.');
  result.license =
    spdx === OTHER_LICENSE
      ? {
          name: required(raw, 'license_name_custom', 'Custom license name'),
        }
      : { name: spdx, spdx_id: spdx };
  result.license.URL = url(raw, 'license_url', 'license URL', true);
}

// Merge only editable section fields into the latest server-owned baseline.
// The browser cannot overwrite ownership, identity, or unrelated sections.
export function applyExtensionDraft(
  base: ExtensionUpdate,
  value: unknown,
): ExtensionUpdate {
  if (!record(value) || !record(value.sections))
    throw new ExtensionValidationError('This draft could not be read.');
  const result = structuredClone(base);
  for (const [section, raw] of Object.entries(value.sections)) {
    if (!record(raw))
      throw new ExtensionValidationError(
        'This draft contains an invalid section.',
      );
    if (section === 'listing') {
      const type = text(raw, 'type');
      if (!isExtensionType(type))
        throw new ExtensionValidationError('Choose a valid extension type.');
      result.name = required(raw, 'name', 'Name');
      result.description = required(raw, 'description', 'Description');
      result.type = type;
      result.website = url(raw, 'website', 'website URL')!;
      result.icon_url = url(raw, 'icon_url', 'icon URL', true);
      if (
        [
          'source_url',
          'source_type',
          'source_repo',
          'license_spdx_id',
          'license_name_custom',
          'license_url',
        ].some((key) => key in raw)
      )
        applySourceAndLicense(result, raw);
    } else if (section === 'readme') {
      result.readme = required(raw, 'readme', 'README');
    } else if (section === 'details') {
      applySourceAndLicense(result, raw);
    } else
      throw new ExtensionValidationError(
        'This draft contains an unknown section.',
      );
  }
  if (value.releases !== undefined) {
    if (
      !Array.isArray(value.releases) ||
      value.releases.length < 1 ||
      value.releases.length > 100
    )
      throw new ExtensionValidationError('Keep between 1 and 100 releases.');
    const tags = new Set<string>();
    result.releases = value.releases.map((raw) => {
      if (!record(raw))
        throw new ExtensionValidationError(
          'This draft contains an invalid release.',
        );
      // Preserve untouched historical releases, including timestamp dates and
      // HTTP URLs; only changed release fields need input normalization.
      const original = base.releases.find((release) => release.tag === raw.tag);
      const release =
        original && JSON.stringify(original) === JSON.stringify(raw)
          ? structuredClone(original)
          : releaseFromFields({
              version_tag: raw.tag,
              release_date: raw.date,
              download_url: raw.download_url,
              changelog_url: raw.changelog_url,
              min_fossbilling_version: raw.min_fossbilling_version,
            });
      if (tags.has(release.tag))
        throw new ExtensionValidationError(
          `A release tagged "${release.tag}" already exists.`,
        );
      tags.add(release.tag);
      return release;
    });
  }
  // Recompute the primary download whenever a draft is changed. Older saved
  // drafts may carry a manual selection; it deliberately has no authority.
  if (Object.keys(value.sections).length || value.releases !== undefined) {
    const latest = latestRelease(result.releases);
    if (latest) {
      result.version =
        latest.tag.replace(/^v/, '') === base.version.replace(/^v/, '')
          ? base.version
          : latest.tag;
      result.download_url = latest.download_url;
    }
  }
  return result;
}
