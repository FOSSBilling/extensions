import type { ExtensionUpdate } from '@/lib/api/client';
import { isExtensionType, isSourceType, type Release } from '@/types';
import {
  buildLicense,
  buildRequirements,
  ExtensionValidationError,
} from './extension-form';
import { isPackageIconPath } from './package-icon';
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
    'readme',
    'version',
    'download_url',
  ] as const;
  if (
    strings.some((key) => typeof value[key] !== 'string') ||
    !Array.isArray(value.releases) ||
    value.manifest_version !== 1 ||
    typeof value.license !== 'string' ||
    !record(value.author) ||
    typeof value.author.name !== 'string' ||
    !record(value.requires) ||
    typeof value.requires.fossbilling !== 'string' ||
    (value.requires.php !== undefined &&
      typeof value.requires.php !== 'string') ||
    value.releases.some(
      (release) =>
        !record(release) ||
        !record(release.requires) ||
        typeof release.requires.fossbilling !== 'string' ||
        (release.requires.php !== undefined &&
          typeof release.requires.php !== 'string'),
    ) ||
    !record(value.source) ||
    !isSourceType(String(value.source.type)) ||
    typeof value.source.repo !== 'string'
  )
    return null;
  const content = value as unknown as ExtensionUpdate;
  return {
    manifest_version: 1,
    author: content.author,
    requires: content.requires,
    type: content.type,
    name: content.name,
    description: content.description,
    homepage_url: content.homepage_url,
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
    manifest_version: 1,
    author:
      record(fields.author) && typeof fields.author.name === 'string'
        ? (fields.author as ExtensionUpdate['author'])
        : { name: '' },
    requires: record(fields.requires)
      ? (fields.requires as ExtensionUpdate['requires'])
      : { fossbilling: '', php: '' },
    type: isExtensionType(type) ? type : 'module',
    name: string('name'),
    description: string('description'),
    homepage_url: string('homepage_url') || string('website') || undefined,
    icon_url: string('icon_url') || undefined,
    readme: string('readme'),
    source:
      record(fields.source) &&
      isSourceType(String(fields.source.type)) &&
      typeof fields.source.repo === 'string'
        ? (fields.source as ExtensionUpdate['source'])
        : { type: 'github', repo: '' },
    license:
      typeof fields.license === 'string'
        ? fields.license
        : record(fields.license)
          ? String(fields.license.spdx_id ?? fields.license.name ?? '')
          : '',
    releases: Array.isArray(fields.releases)
      ? fields.releases.map((value) => {
          const release = record(value) ? value : {};
          return {
            tag: String(release.tag ?? ''),
            date: String(release.date ?? ''),
            download_url: String(release.download_url ?? ''),
            changelog_url:
              typeof release.changelog_url === 'string'
                ? release.changelog_url
                : undefined,
            requires: record(release.requires)
              ? (release.requires as ExtensionUpdate['requires'])
              : { fossbilling: '', php: '' },
          };
        })
      : [],
    version: string('version'),
    download_url: string('download_url'),
  };
}

function toFormData(fields: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields))
    if (typeof value === 'string') form.set(key, value);
  return form;
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
    requires: buildRequirements(toFormData(fields)),
  };
}

function applySourceAndLicense(
  result: ExtensionUpdate,
  raw: Record<string, unknown>,
): void {
  const source = repositoryFromFields(raw);
  if (!source)
    throw new ExtensionValidationError(
      'Enter a valid Source URL. Repository paths and custom URLs must be at most 500 characters.',
    );
  result.source = source;
  result.license = buildLicense(toFormData(raw));
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
      result.homepage_url = url(raw, 'homepage_url', 'homepage URL', true);
      const icon = text(raw, 'icon_url');
      if (icon && !isPackageIconPath(icon))
        throw new ExtensionValidationError(
          'Enter an icon path relative to the package root.',
        );
      result.icon_url = icon || undefined;
      result.author = {
        name: required(raw, 'author_name', 'Author name'),
        url: url(raw, 'author_url', 'author URL', true),
      };
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
              requires_fossbilling: record(raw.requires)
                ? raw.requires.fossbilling
                : undefined,
              requires_php: record(raw.requires) ? raw.requires.php : undefined,
              requires_modules:
                record(raw.requires) && record(raw.requires.modules)
                  ? Object.entries(raw.requires.modules)
                      .map(([id, constraint]) => `${id}: ${constraint}`)
                      .join('\n')
                  : '',
            });
      if (tags.has(release.tag.replace(/^v/, '')))
        throw new ExtensionValidationError(
          `A release tagged "${release.tag}" already exists.`,
        );
      tags.add(release.tag.replace(/^v/, ''));
      return release;
    });
  }
  // Recompute the primary download whenever a draft is changed. Older saved
  // drafts may carry a manual selection; it deliberately has no authority.
  if (Object.keys(value.sections).length || value.releases !== undefined) {
    const latest = latestRelease(result.releases);
    if (latest) {
      // Keep the manifest aligned with its latest release.
      result.requires = structuredClone(latest.requires);
      result.version = latest.tag.replace(/^v(?=\d)/, '');
      result.download_url = latest.download_url;
    }
  }
  return result;
}
