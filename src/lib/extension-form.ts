import { isExtensionType, SPDX_LICENSE_IDS } from '@/types';
import type { Extension, Release } from '@/types';
import type { ExtensionCreate, ExtensionUpdate } from '@/lib/api/client';
import { latestRelease } from './releases';
import { repositoryFromFields, repositoryInputUrl } from './repository';
import { formString } from './form';
import { withHttpsScheme } from './url-prefix';

// Thrown for form-level validation failures that should be shown to the
// user, distinct from ApiRequestError (the api rejecting an otherwise
// well-formed payload) — see the try/catch in new.astro/edit.astro.
export class ExtensionValidationError extends Error {}

// "Other / Proprietary" is a form-only sentinel, never a real spdx_id value
// — buildLicense() reads it back out of license_spdx_id to decide whether
// license_name_custom (vs. the spdx_id itself) becomes license.name. The
// single export here is what ExtensionForm.astro and edit.astro both use,
// rather than each hand-copying the string.
export const OTHER_LICENSE = 'other';

// The License field pair: a <select> of current SPDX ids (matching the api's
// own spdx-license-ids-backed validation) plus an "Other / Proprietary"
// sentinel that reveals a free-text name instead. Mirrors the server: a
// recognized id becomes both `name` and `spdx_id`; "Other" carries only a
// custom `name`.
function buildLicense(form: FormData) {
  const selected = formString(form, 'license_spdx_id');
  const url = withHttpsScheme(formString(form, 'license_url'));

  if (selected === OTHER_LICENSE) {
    const customName = formString(form, 'license_name_custom');
    if (!customName) {
      throw new ExtensionValidationError(
        'Enter a name for the custom or proprietary license.',
      );
    }
    return { name: customName, URL: url };
  }

  if (!SPDX_LICENSE_IDS.includes(selected)) {
    throw new ExtensionValidationError(
      'Choose a license, or "Other / Proprietary" for one not listed.',
    );
  }

  return { name: selected, spdx_id: selected, URL: url };
}

// Shared by both builders below. A new release is only appended when
// version_tag is filled — required when there are no existing releases to
// carry through (a brand new extension, or one resubmitting after rejection
// with nothing ever published), optional otherwise, since the api replaces
// the whole releases array on approval and existing releases are always
// carried through unchanged.
function buildContent(
  form: FormData,
  existing: { releases: Release[]; version: string; download_url: string },
  requireRelease: boolean,
) {
  const str = (name: string) => formString(form, name);

  const releases = [...existing.releases];
  let version = existing.version;
  let downloadUrl = existing.download_url;

  const newReleaseTag = str('version_tag');
  if (requireRelease && !newReleaseTag) {
    throw new ExtensionValidationError(
      'An initial release (version, release date, and download URL) is required.',
    );
  }
  if (newReleaseTag) {
    // The api stores at most 100 releases, and doesn't itself reject a tag
    // collision — since it replaces the whole array verbatim on approval, a
    // collision would silently duplicate the entry. Catch both here instead
    // of only one of them surfacing as a 422 from the api.
    if (releases.some((r) => r.tag === newReleaseTag)) {
      throw new ExtensionValidationError(
        `A release tagged "${newReleaseTag}" already exists — use a different version tag.`,
      );
    }
    if (releases.length >= 100) {
      throw new ExtensionValidationError(
        'This extension already has the maximum of 100 releases.',
      );
    }

    const releaseDate = str('release_date');
    const releaseDownloadUrl = withHttpsScheme(str('download_url'));
    const minVersion = str('min_fossbilling_version');
    if (!releaseDate || !releaseDownloadUrl || !minVersion) {
      throw new ExtensionValidationError(
        'To add a new release, fill in the release date, download URL, and minimum FOSSBilling version.',
      );
    }

    const release: Release = {
      tag: newReleaseTag,
      date: releaseDate,
      download_url: releaseDownloadUrl,
      changelog_url: withHttpsScheme(str('changelog_url')),
      min_fossbilling_version: minVersion,
    };
    releases.push(release);
    version = release.tag;
    downloadUrl = release.download_url;
  }

  const latest = latestRelease(releases);
  if (latest) {
    version =
      latest.tag.replace(/^v/, '') === existing.version.replace(/^v/, '')
        ? existing.version
        : latest.tag;
    downloadUrl = latest.download_url;
  }

  const typeInput = str('type');
  const sourceFields = Object.fromEntries(form);
  const source = repositoryFromFields(sourceFields);
  if (!source)
    throw new ExtensionValidationError(
      'Enter a valid HTTP or HTTPS Source URL.',
    );
  if (!isExtensionType(typeInput)) {
    throw new ExtensionValidationError('Choose a valid extension type.');
  }

  return {
    type: typeInput,
    name: str('name'),
    description: str('description'),
    releases,
    website: withHttpsScheme(str('website')) ?? '',
    license: buildLicense(form),
    icon_url: withHttpsScheme(str('icon_url')),
    readme: str('readme'),
    source,
    version,
    download_url: downloadUrl,
  };
}

// Builds the payload for POST /extensions. The id is only ever set here —
// PUT can't rename, since the id comes from the path and is immutable.
export function buildExtensionCreatePayload(form: FormData): ExtensionCreate {
  return {
    id: formString(form, 'extension_id').toLowerCase(),
    ...buildContent(
      form,
      { releases: [], version: '', download_url: '' },
      true,
    ),
  };
}

// Builds the payload for PUT /extensions/{id}. `existing` is the extension's
// current published content, when it has any — an extension can be edited
// with nothing published yet (rejected and never resubmitted), in which case
// a release is required same as creation.
export function buildExtensionUpdatePayload(
  form: FormData,
  existing: Extension | null,
): ExtensionUpdate {
  return buildContent(
    form,
    existing ?? { releases: [], version: '', download_url: '' },
    !existing?.releases.length,
  );
}

// Best-effort echo of what the user submitted, spread over the extension's
// current content for redisplay when an edit or correction is rejected.
// Mirrors buildLicense(), minus the validation — this is not the payload
// itself, so an incomplete choice here is fine to redisplay as-is rather
// than reject. Shared by the author edit page and the moderator correction
// page so a new form field only needs adding here.
export function echoExtensionFromForm(
  form: FormData,
  base: Extension,
): Extension {
  const selectedLicenseId = formString(form, 'license_spdx_id');
  const isRecognizedLicense =
    selectedLicenseId !== OTHER_LICENSE &&
    SPDX_LICENSE_IDS.includes(selectedLicenseId);
  return {
    ...base,
    type: formString(form, 'type') as Extension['type'],
    name: formString(form, 'name'),
    description: formString(form, 'description'),
    website: formString(form, 'website'),
    icon_url: formString(form, 'icon_url') || undefined,
    readme: formString(form, 'readme'),
    license: isRecognizedLicense
      ? {
          name: selectedLicenseId,
          spdx_id: selectedLicenseId,
          URL: formString(form, 'license_url') || undefined,
        }
      : {
          name: formString(form, 'license_name_custom'),
          URL: formString(form, 'license_url') || undefined,
        },
    source: repositoryFromFields(Object.fromEntries(form)) ?? {
      type: 'custom',
      repo: repositoryInputUrl(Object.fromEntries(form)),
    },
  };
}

// The release-section input values as submitted, echoed alongside
// echoExtensionFromForm: the Extension model has nowhere to hold a pending
// release draft (version tag, date, URLs, minimum version), so without this
// a failed submission would redisplay that fieldset blank and discard it.
// Values are echoed exactly as typed — no scheme normalization — matching
// the best-effort redisplay contract above.
export interface ReleaseDraft {
  version_tag: string;
  release_date: string;
  download_url: string;
  changelog_url: string;
  min_fossbilling_version: string;
}

export function echoReleaseDraftFromForm(form: FormData): ReleaseDraft {
  return {
    version_tag: formString(form, 'version_tag'),
    release_date: formString(form, 'release_date'),
    download_url: formString(form, 'download_url'),
    changelog_url: formString(form, 'changelog_url'),
    min_fossbilling_version: formString(form, 'min_fossbilling_version'),
  };
}

// Best-effort echo for the create page: there is no existing extension to
// spread over, so the base is a blank, submission-shaped extension — the id
// comes from the form (lowercased, matching what a successful submit would
// store) and the developer is the submitter's own profile. Returns both the
// field echo and the release draft for ExtensionForm's redisplay props.
export function echoNewExtensionFromForm(
  form: FormData,
  developer: Extension['developer'],
): { extension: Extension; releaseDraft: ReleaseDraft } {
  const base: Extension = {
    id: formString(form, 'extension_id').toLowerCase(),
    type: 'mod',
    name: '',
    description: '',
    releases: [],
    website: '',
    license: { name: '' },
    readme: '',
    source: { type: 'github', repo: '' },
    version: '',
    download_url: '',
    developer,
  };

  return {
    extension: echoExtensionFromForm(form, base),
    releaseDraft: echoReleaseDraftFromForm(form),
  };
}
