import { isExtensionType, isSourceType } from '@/types';
import type { Extension, Release } from '@/types';
import type { ExtensionCreate, ExtensionUpdate } from '@/lib/api/client';
import { formString } from './form';
import { withHttpsScheme } from './url-prefix';

// Thrown for form-level validation failures that should be shown to the
// user, distinct from ApiRequestError (the api rejecting an otherwise
// well-formed payload) — see the try/catch in new.astro/edit.astro.
export class ExtensionValidationError extends Error {}

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

  const typeInput = str('type');
  const sourceTypeInput = str('source_type');
  if (!isExtensionType(typeInput) || !isSourceType(sourceTypeInput)) {
    throw new ExtensionValidationError(
      'Choose a valid extension type and repository host.',
    );
  }

  return {
    type: typeInput,
    name: str('name'),
    description: str('description'),
    releases,
    website: withHttpsScheme(str('website')) ?? '',
    license: {
      name: str('license_name'),
      URL: withHttpsScheme(str('license_url')),
    },
    icon_url: withHttpsScheme(str('icon_url')),
    readme: str('readme'),
    source: {
      type: sourceTypeInput,
      repo: str('source_repo'),
    },
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
