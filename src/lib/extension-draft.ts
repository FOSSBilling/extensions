import type { ExtensionUpdate } from '@/lib/api/client';
import { isExtensionType, isSourceType, type Release } from '@/types';
import {
  buildLicense,
  ExtensionValidationError,
  formUrl,
  releaseDetails,
} from './extension-form';
import { latestRelease } from './releases';
import { repositoryFromFields, SOURCE_URL_ERROR } from './repository';

export type DraftSection = 'listing' | 'readme';
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
    readme: content.readme,
    license: content.license,
    source: content.source,
    releases: content.releases,
    version: content.version,
    download_url: content.download_url,
  };
}

// A compacted rejected submission may need its missing fields filled again.
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
    homepage_url: string('homepage_url') || undefined,
    readme: string('readme'),
    source:
      record(fields.source) &&
      isSourceType(String(fields.source.type)) &&
      typeof fields.source.repo === 'string'
        ? (fields.source as ExtensionUpdate['source'])
        : { type: 'github', repo: '' },
    license: string('license'),
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
            is_latest: release.is_latest === true ? true : undefined,
            artifact_id:
              typeof release.artifact_id === 'string'
                ? release.artifact_id
                : undefined,
            sha256:
              typeof release.sha256 === 'string' ? release.sha256 : undefined,
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
function releaseRequirements(value: unknown): Release['requires'] {
  const isConstraint = (constraint: unknown): constraint is string =>
    typeof constraint === 'string' &&
    constraint.length <= 1000 &&
    /\S/.test(constraint);
  if (
    !record(value) ||
    !isConstraint(value.fossbilling) ||
    (value.php !== undefined && !isConstraint(value.php)) ||
    (value.modules !== undefined &&
      (!record(value.modules) ||
        Object.entries(value.modules).some(
          ([id, constraint]) =>
            !/^[a-z0-9_-]+$/.test(id) || !isConstraint(constraint),
        )))
  ) {
    throw new ExtensionValidationError(
      'This release contains invalid compatibility requirements.',
    );
  }
  return value as Release['requires'];
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
      const tag = required(raw, 'tag', 'Version tag');
      const version = tag.replace(/^v/, '');
      if (tags.has(version))
        throw new ExtensionValidationError(
          `A release tagged "${tag}" already exists.`,
        );
      tags.add(version);
      const previous = base.releases.find((release) => release.tag === raw.tag);
      if (previous && JSON.stringify(previous) === JSON.stringify(raw))
        return structuredClone(previous);
      const artifactId = text(raw, 'artifact_id');
      const release: Release = {
        tag,
        ...releaseDetails({
          release_date:
            previous && raw.date === previous.date
              ? previous.date.slice(0, 10)
              : raw.date,
          changelog_url: raw.changelog_url,
        }),
        download_url: formUrl(raw.download_url, 'download URL')!,
        requires: releaseRequirements(raw.requires),
        ...(artifactId
          ? {
              artifact_id: artifactId,
              sha256: text(raw, 'sha256') || undefined,
            }
          : {}),
      };
      if (previous) {
        if (raw.date === previous.date) release.date = previous.date;
        if (raw.download_url === previous.download_url)
          release.download_url = previous.download_url;
        if (raw.changelog_url === previous.changelog_url)
          release.changelog_url = previous.changelog_url;
      }
      if (raw.is_latest !== undefined && typeof raw.is_latest !== 'boolean')
        throw new ExtensionValidationError(
          'This draft contains an invalid latest release selection.',
        );
      if (raw.is_latest === true) release.is_latest = true;
      return release;
    });
  }
  if (
    result.releases.filter((release) => release.is_latest === true).length > 1
  )
    throw new ExtensionValidationError('Select only one latest release.');
  const latest = latestRelease(result.releases);
  for (const [section, raw] of Object.entries(value.sections)) {
    if (!record(raw))
      throw new ExtensionValidationError(
        'This draft contains an invalid section.',
      );
    if (section === 'listing') {
      result.description = required(raw, 'description', 'Description');
      const source = repositoryFromFields(raw);
      if (!source) throw new ExtensionValidationError(SOURCE_URL_ERROR);
      result.source = source;
      if (latest?.artifact_id || !('type' in raw)) continue;
      const type = text(raw, 'type');
      if (!isExtensionType(type))
        throw new ExtensionValidationError('Choose a valid extension type.');
      result.name = required(raw, 'name', 'Name');
      result.type = type;
      result.homepage_url = formUrl(raw.homepage_url, 'homepage URL', true);
      result.author = {
        name: required(raw, 'author_name', 'Author name'),
        url: formUrl(raw.author_url, 'author URL', true),
      };
      result.license = buildLicense(toFormData(raw));
    } else if (section === 'readme') {
      result.readme = required(raw, 'readme', 'README');
    } else
      throw new ExtensionValidationError(
        'This draft contains an unknown section.',
      );
  }
  // Keep the main download and compatibility aligned with the selected release.
  if (
    latest &&
    (Object.keys(value.sections).length || value.releases !== undefined)
  ) {
    result.requires = structuredClone(latest.requires);
    result.version = latest.tag.replace(/^v(?=\d)/, '');
    result.download_url = latest.download_url;
  }
  return result;
}
