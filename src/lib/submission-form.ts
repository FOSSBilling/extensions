import { EXTENSION_TYPES, SOURCE_TYPES } from '@/types';
import type {
  Developer,
  Extension,
  Release,
  Repository,
  SubmissionPayload,
} from '@/types';
import { formString } from './form';
import { withHttpsScheme } from './url-prefix';

// Thrown for form-level validation failures that should be shown to the
// user, distinct from ApiRequestError (the api rejecting an otherwise
// well-formed payload) — see the try/catch in new.astro/edit.astro.
export class SubmissionValidationError extends Error {}

function isExtensionType(value: string): value is Extension['type'] {
  return (EXTENSION_TYPES as readonly string[]).includes(value);
}

function isSourceType(value: string): value is Repository['type'] {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

// Builds a SubmissionPayload from the ExtensionSubmissionForm component's
// fields. A new release is only appended when version_tag is filled — for
// edits that's optional (see the form's required={!isEdit}), and the api
// replaces the whole releases array on approval, so existing releases are
// always carried through unchanged.
export function buildSubmissionPayload(
  form: FormData,
  developer: Developer,
  existingExtension?: Extension,
): SubmissionPayload {
  const str = (name: string) => formString(form, name);

  const releases = existingExtension ? [...existingExtension.releases] : [];
  let version = existingExtension?.version ?? '';
  let downloadUrl = existingExtension?.download_url ?? '';

  const newReleaseTag = str('version_tag');
  if (!existingExtension && !newReleaseTag) {
    throw new SubmissionValidationError(
      'An initial release (version, release date, and download URL) is required.',
    );
  }
  if (newReleaseTag) {
    const releaseDate = str('release_date');
    const releaseDownloadUrl = withHttpsScheme(str('download_url'));
    const minVersion = str('min_fossbilling_version');
    if (!releaseDate || !releaseDownloadUrl || !minVersion) {
      throw new SubmissionValidationError(
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
    throw new SubmissionValidationError(
      'Choose a valid extension type and repository host.',
    );
  }

  return {
    developer,
    extension: {
      // In edit mode, always use the id of the already-verified extension —
      // never the form's own extension_id — so the payload can't be aimed at
      // a different extension than the one the caller was confirmed to own.
      id: existingExtension?.id ?? str('extension_id').toLowerCase(),
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
    },
  };
}
