import { isExtensionType, SPDX_LICENSE_IDS } from '@/types';
import type { Extension } from '@/types';
import type {
  ExtensionCreate,
  ExtensionUpdate,
  Manifest,
  PackageArtifact,
} from '@/lib/api/client';
import { latestRelease } from './releases';
import { repositoryFromFields, repositoryInputUrl } from './repository';
import { formString } from './form';
import { withHttpsScheme } from './url-prefix';

export type ExtensionFormEcho = Extension & { moduleRequirementsInput: string };

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

function moduleRequirements(input: string): Record<string, string> | undefined {
  if (!input.trim()) return undefined;
  const modules: Record<string, string> = Object.create(null);
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([a-z0-9_-]+)\s*:\s*(.+)$/.exec(line.trim());
    if (
      !match ||
      !match[2].trim() ||
      match[2].trim().length > 1000 ||
      Object.hasOwn(modules, match[1])
    )
      throw new ExtensionValidationError(
        'Enter module dependencies once each, as module-id: constraint on separate lines.',
      );
    modules[match[1]] = match[2].trim();
  }
  return modules;
}

export function formatModuleRequirements(
  modules?: Record<string, string>,
): string {
  return Object.entries(modules ?? {})
    .map(([id, constraint]) => `${id}: ${constraint}`)
    .join('\n');
}

export function buildRequirements(form: FormData) {
  const fossbilling = formString(form, 'requires_fossbilling');
  const php = formString(form, 'requires_php');
  if (!fossbilling || fossbilling.length > 1000 || php.length > 1000)
    throw new ExtensionValidationError(
      'Enter a FOSSBilling requirement and, optionally, an additional PHP constraint (up to 1,000 characters each).',
    );
  return {
    fossbilling,
    ...(php ? { php } : {}),
    modules: moduleRequirements(formString(form, 'requires_modules')),
  };
}

function listingFields(form: FormData) {
  const source = repositoryFromFields(Object.fromEntries(form));
  if (!source)
    throw new ExtensionValidationError(
      'Enter a valid Source URL. Repository paths and custom URLs must be at most 500 characters.',
    );
  return {
    ...manifestFields(form),
    readme: formString(form, 'readme'),
    source,
  };
}

function manifestFields(form: FormData): Omit<Manifest, 'id' | 'version'> {
  const str = (name: string) => formString(form, name);
  const typeInput = str('type');
  if (!isExtensionType(typeInput)) {
    throw new ExtensionValidationError('Choose a valid extension type.');
  }

  if (!str('author_name'))
    throw new ExtensionValidationError('Enter the package author name.');
  return {
    manifest_version: 1,
    author: {
      name: str('author_name'),
      url: withHttpsScheme(str('author_url')),
    },
    requires: buildRequirements(form),
    type: typeInput,
    name: str('name'),
    description: str('description'),
    homepage_url: withHttpsScheme(str('homepage_url')),
    license: buildLicense(form),
  };
}

export function manifestFromCreateForm(form: FormData): Manifest {
  return {
    ...manifestFields(form),
    id: formString(form, 'extension_id').toLowerCase(),
    version: formString(form, 'version_tag').replace(/^v(?=\d)/, ''),
  };
}

export function buildExtensionCreatePayload(
  form: FormData,
  artifact: PackageArtifact,
): ExtensionCreate {
  if (!formString(form, 'version_tag') || !formString(form, 'release_date'))
    throw new ExtensionValidationError(
      'An initial release and release date are required.',
    );
  return {
    id: formString(form, 'extension_id').toLowerCase(),
    ...listingFields(form),
    version: artifact.manifest.version,
    requires: artifact.manifest.requires,
    download_url: artifact.download_url,
    releases: [
      {
        tag: artifact.manifest.version,
        date: formString(form, 'release_date'),
        changelog_url: withHttpsScheme(formString(form, 'changelog_url')),
        requires: artifact.manifest.requires,
        artifact_id: artifact.id,
        sha256: artifact.sha256,
        download_url: artifact.download_url,
        is_latest: true,
      },
    ],
  };
}

// Moderator corrections change listing metadata; release creation uses the release editor.
export function buildExtensionUpdatePayload(
  form: FormData,
  existing: Extension,
): ExtensionUpdate {
  const fields = listingFields(form);
  const latest = latestRelease(existing.releases);
  if (!latest?.artifact_id)
    throw new ExtensionValidationError(
      'The latest release needs a stored package before its metadata can be corrected.',
    );
  return {
    ...fields,
    releases: existing.releases.map((release) =>
      release === latest ? { ...release, requires: fields.requires } : release,
    ),
    version: latest.tag.replace(/^v(?=\d)/, ''),
    download_url: latest.download_url,
  };
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
): ExtensionFormEcho {
  const selectedLicenseId = formString(form, 'license_spdx_id');
  const isRecognizedLicense =
    selectedLicenseId !== OTHER_LICENSE &&
    SPDX_LICENSE_IDS.includes(selectedLicenseId);
  return {
    ...base,
    type: formString(form, 'type') as Extension['type'],
    name: formString(form, 'name'),
    description: formString(form, 'description'),
    homepage_url: formString(form, 'homepage_url'),

    readme: formString(form, 'readme'),
    manifest_version: 1,
    author: {
      name: formString(form, 'author_name'),
      url: formString(form, 'author_url') || undefined,
    },
    requires: {
      fossbilling: formString(form, 'requires_fossbilling'),
      php: formString(form, 'requires_php'),
      modules: base.requires.modules,
    },
    moduleRequirementsInput: formString(form, 'requires_modules'),
    license: isRecognizedLicense
      ? selectedLicenseId
      : formString(form, 'license_name_custom'),
    source: repositoryFromFields(Object.fromEntries(form)) ?? {
      type: 'custom',
      repo: repositoryInputUrl(Object.fromEntries(form)),
    },
  };
}

// Values needed to redisplay a failed initial-release submission.
export interface ReleaseDraft {
  version_tag: string;
  release_date: string;
  changelog_url: string;
}

export function echoReleaseDraftFromForm(form: FormData): ReleaseDraft {
  return {
    version_tag: formString(form, 'version_tag'),
    release_date: formString(form, 'release_date'),
    changelog_url: formString(form, 'changelog_url'),
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
): { extension: ExtensionFormEcho; releaseDraft: ReleaseDraft } {
  const base: Extension = {
    manifest_version: 1,
    author: { name: developer.name, url: developer.URL },
    requires: { fossbilling: '', php: '' },
    id: formString(form, 'extension_id').toLowerCase(),
    type: 'module',
    name: '',
    description: '',
    releases: [],
    homepage_url: '',
    license: '',
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
