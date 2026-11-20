import { SPDX_LICENSE_IDS } from '@/types';
import type { Extension } from '@/types';
import type {
  ExtensionCreate,
  ExtensionUpdate,
  PackageArtifact,
} from '@/lib/api/client';
import { artifactRelease } from './extension-package';
import { latestRelease } from './releases';
import { repositoryFromFields, SOURCE_URL_ERROR } from './repository';
import { formString } from './form';
import { isSafeHttpUrl } from './safe-url';
import { withHttpsScheme } from './url-prefix';

// Thrown for form-level validation failures that should be shown to the
// user, distinct from ApiRequestError (the api rejecting an otherwise
// well-formed payload) — see the try/catch in new.astro/edit.astro.
export class ExtensionValidationError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

// The combobox offers SPDX identifiers; Other also accepts compound expressions.
export const OTHER_LICENSE = 'other';

export function buildLicense(form: FormData): string {
  const selected = formString(form, 'license_spdx_id');
  const license =
    selected === OTHER_LICENSE
      ? formString(form, 'license_name_custom')
      : selected;
  if (
    !license ||
    license.length > 1000 ||
    !/^[A-Za-z0-9.\-+_:() |]+$/.test(license) ||
    (selected !== OTHER_LICENSE && !SPDX_LICENSE_IDS.includes(selected))
  ) {
    throw new ExtensionValidationError(
      'Choose a license or enter a license expression.',
    );
  }
  return license;
}

export function formUrl(
  value: unknown,
  label: string,
  { optional = false, preserveScheme = false } = {},
): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw && optional) return undefined;
  const url = preserveScheme ? raw : withHttpsScheme(raw);
  if (url && url.length > 2048)
    throw new ExtensionValidationError(
      `Enter a ${label} of 2,048 characters or fewer.`,
    );
  if (isSafeHttpUrl(url)) return url;
  throw new ExtensionValidationError(`Enter a valid ${label}.`);
}

export function releaseDetails(fields: Record<string, unknown>) {
  const date =
    typeof fields.release_date === 'string' ? fields.release_date.trim() : '';
  if (!date) throw new ExtensionValidationError('Release date is required.');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new ExtensionValidationError('Enter a valid release date.');
  return {
    date,
    changelog_url: formUrl(fields.changelog_url, 'changelog URL', {
      optional: true,
    }),
  };
}

function directoryFields(form: FormData) {
  const source = repositoryFromFields(Object.fromEntries(form));
  if (!source) throw new ExtensionValidationError(SOURCE_URL_ERROR);
  return {
    description: formString(form, 'description'),
    readme: formString(form, 'readme'),
    source,
  };
}

export function buildExtensionCreatePayload(
  form: FormData,
  artifact: PackageArtifact,
): ExtensionCreate {
  const { id, ...manifest } = artifact.manifest;
  const listing = directoryFields(form);
  return {
    ...manifest,
    ...listing,
    identifier: id,
    description: listing.description || manifest.description,
    download_url: artifact.download_url,
    releases: [
      {
        ...artifactRelease(releaseDetails(Object.fromEntries(form)), artifact),
        is_latest: true,
      },
    ],
  };
}

// Moderator corrections edit directory presentation without replacing the release.
export function buildExtensionUpdatePayload(
  form: FormData,
  existing: Extension,
): ExtensionUpdate {
  const latest = latestRelease(existing.releases);
  if (!latest?.artifact_id)
    throw new ExtensionValidationError(
      'The latest release needs a validated package before its listing can be corrected.',
    );
  const {
    author,
    requires,
    type,
    name,
    homepage_url,
    license,
    manifest_version,
    releases,
    version,
    download_url,
  } = existing;
  return {
    author,
    requires,
    type,
    name,
    homepage_url,
    license,
    manifest_version,
    releases,
    version,
    download_url,
    ...directoryFields(form),
  };
}
