import type {
  Author,
  Extension,
  ExtensionPayload,
  Release,
  SubmissionPayload,
} from '@/types';

// Builds a SubmissionPayload from the ExtensionSubmissionForm component's
// fields. A new release is only appended when version_tag is filled — for
// edits that's optional (see the form's required={!isEdit}), and the api
// replaces the whole releases array on approval, so existing releases are
// always carried through unchanged.
export function buildSubmissionPayload(
  form: FormData,
  author: Author,
  existingExtension?: Extension,
): SubmissionPayload {
  const str = (name: string) =>
    ((form.get(name) as string | null) ?? '').trim();

  const releases = existingExtension ? [...existingExtension.releases] : [];
  let version = existingExtension?.version ?? '';
  let downloadUrl = existingExtension?.download_url ?? '';

  const newReleaseTag = str('version_tag');
  if (newReleaseTag) {
    const release: Release = {
      tag: newReleaseTag,
      date: str('release_date'),
      download_url: str('download_url'),
      changelog_url: str('changelog_url') || undefined,
      min_fossbilling_version: str('min_fossbilling_version'),
    };
    releases.push(release);
    version = release.tag;
    downloadUrl = release.download_url;
  }

  return {
    author,
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
