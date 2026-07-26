import type {
  Developer,
  Extension,
  ExtensionPayload,
  Release,
  SubmissionPayload,
} from '@/types';
import { formString } from './form';

// Thrown for form-level validation failures that should be shown to the
// user, distinct from ApiRequestError (the api rejecting an otherwise
// well-formed payload) — see the try/catch in new.astro/edit.astro.
export class SubmissionValidationError extends Error {}

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
  if (newReleaseTag) {
    const releaseDate = str('release_date');
    const releaseDownloadUrl = str('download_url');
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
      changelog_url: str('changelog_url') || undefined,
      min_fossbilling_version: minVersion,
    };
    releases.push(release);
    version = release.tag;
    downloadUrl = release.download_url;
  }

  return {
    developer,
    extension: {
      id: str('extension_id').toLowerCase(),
      type: str('type') as ExtensionPayload['type'],
      name: str('name'),
      description: str('description'),
      releases,
      website: str('website'),
      license: {
        name: str('license_name'),
        URL: str('license_url') || undefined,
      },
      icon_url: str('icon_url') || undefined,
      readme: str('readme'),
      source: {
        type: str('source_type') as ExtensionPayload['source']['type'],
        repo: str('source_repo'),
      },
      version,
      download_url: downloadUrl,
    },
  };
}
