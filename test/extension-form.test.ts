import { describe, expect, it } from 'vitest';
import {
  buildExtensionCreatePayload,
  buildExtensionUpdatePayload,
  echoExtensionFromForm,
  echoNewExtensionFromForm,
  echoReleaseDraftFromForm,
  ExtensionValidationError,
} from '@/lib/extension-form';
import type { Extension } from '@/types';

function extensionForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set('extension_id', 'example');
  form.set('type', 'mod');
  form.set('name', 'Example');
  form.set('description', 'An example extension.');
  form.set('website', 'example.test');
  form.set('license_spdx_id', 'MIT');
  form.set('license_url', 'https://example.test/license');
  form.set('readme', '# Example');
  form.set('source_type', 'github');
  form.set('source_repo', 'fossbilling/example');
  form.set('version_tag', '1.0.0');
  form.set('release_date', '2026-01-01');
  form.set('download_url', 'https://example.test/example.zip');
  form.set('min_fossbilling_version', '0.6.0');
  for (const [key, value] of Object.entries(overrides)) {
    form.set(key, value);
  }
  return form;
}

const publishedExtension: Extension = {
  id: 'example',
  type: 'mod',
  name: 'Example',
  description: 'An example extension.',
  releases: [
    {
      tag: '0.9.0',
      date: '2025-12-01',
      download_url: 'https://example.test/example-0.9.0.zip',
      min_fossbilling_version: '0.5.0',
    },
  ],
  website: 'https://example.test',
  license: { name: 'MIT', spdx_id: 'MIT' },
  readme: '# Example',
  source: { type: 'github', repo: 'fossbilling/example' },
  version: '0.9.0',
  download_url: 'https://example.test/example-0.9.0.zip',
  developer: {
    id: 'developer',
    type: 'organization',
    name: 'Example developer',
  },
};

describe('buildExtensionCreatePayload', () => {
  it('builds a POST /extensions payload with no developer field', () => {
    const payload = buildExtensionCreatePayload(extensionForm());

    expect(payload).not.toHaveProperty('developer');
    expect(payload.id).toBe('example');
    expect(payload.name).toBe('Example');
    expect(payload.releases).toEqual([
      {
        tag: '1.0.0',
        date: '2026-01-01',
        download_url: 'https://example.test/example.zip',
        changelog_url: undefined,
        min_fossbilling_version: '0.6.0',
      },
    ]);
  });

  it('lowercases the extension id', () => {
    const payload = buildExtensionCreatePayload(
      extensionForm({ extension_id: 'Example-ID' }),
    );

    expect(payload.id).toBe('example-id');
  });

  it('requires an initial release', () => {
    const form = extensionForm({ version_tag: '' });
    form.delete('release_date');
    form.delete('download_url');
    form.delete('min_fossbilling_version');

    expect(() => buildExtensionCreatePayload(form)).toThrow(
      ExtensionValidationError,
    );
  });

  it('sets both name and spdx_id for a recognized license', () => {
    const payload = buildExtensionCreatePayload(
      extensionForm({ license_spdx_id: 'Apache-2.0' }),
    );

    expect(payload.license).toEqual({
      name: 'Apache-2.0',
      spdx_id: 'Apache-2.0',
      URL: 'https://example.test/license',
    });
  });

  it('rejects a license_spdx_id that is not a real SPDX identifier', () => {
    const form = extensionForm({ license_spdx_id: 'not-a-real-license' });

    expect(() => buildExtensionCreatePayload(form)).toThrow(
      ExtensionValidationError,
    );
  });

  it('uses the custom name with no spdx_id for Other / Proprietary', () => {
    const payload = buildExtensionCreatePayload(
      extensionForm({
        license_spdx_id: 'other',
        license_name_custom: 'Acme Proprietary License',
      }),
    );

    expect(payload.license).toEqual({
      name: 'Acme Proprietary License',
      URL: 'https://example.test/license',
    });
  });

  it('requires a custom name when Other / Proprietary is selected', () => {
    const form = extensionForm({ license_spdx_id: 'other' });

    expect(() => buildExtensionCreatePayload(form)).toThrow(
      ExtensionValidationError,
    );
  });
});

describe('buildExtensionUpdatePayload', () => {
  it('carries existing releases through unchanged when no new release is added', () => {
    const form = extensionForm();
    form.delete('version_tag');
    form.delete('release_date');
    form.delete('download_url');
    form.delete('min_fossbilling_version');

    const payload = buildExtensionUpdatePayload(form, publishedExtension);

    expect(payload).not.toHaveProperty('developer');
    expect(payload).not.toHaveProperty('id');
    expect(payload.releases).toEqual(publishedExtension.releases);
    expect(payload.version).toBe('0.9.0');
  });

  it('appends a new release and updates version/download_url when provided', () => {
    const payload = buildExtensionUpdatePayload(
      extensionForm(),
      publishedExtension,
    );

    expect(payload.releases).toHaveLength(2);
    expect(payload.version).toBe('1.0.0');
    expect(payload.download_url).toBe('https://example.test/example.zip');
  });

  it('requires an initial release when nothing has ever been published', () => {
    const form = extensionForm({ version_tag: '' });
    form.delete('release_date');
    form.delete('download_url');
    form.delete('min_fossbilling_version');

    expect(() => buildExtensionUpdatePayload(form, null)).toThrow(
      ExtensionValidationError,
    );
  });

  it('rejects a version_tag that duplicates an existing release instead of appending a second copy', () => {
    const form = extensionForm({ version_tag: '0.9.0' });

    expect(() => buildExtensionUpdatePayload(form, publishedExtension)).toThrow(
      ExtensionValidationError,
    );
  });

  it('rejects a new release once the extension already has 100', () => {
    const atLimit: Extension = {
      ...publishedExtension,
      releases: Array.from({ length: 100 }, (_, i) => ({
        tag: `0.${i}.0`,
        date: '2025-01-01',
        download_url: `https://example.test/example-0.${i}.0.zip`,
        min_fossbilling_version: '0.5.0',
      })),
    };

    expect(() => buildExtensionUpdatePayload(extensionForm(), atLimit)).toThrow(
      ExtensionValidationError,
    );
  });
});

describe('echoExtensionFromForm', () => {
  // The submitted echo is a best-effort redisplay spread over the
  // extension's current content — never the validated payload — so an
  // incomplete license choice must redisplay as-is instead of throwing.
  it('echoes submitted fields over the base and keeps base-only fields', () => {
    const form = extensionForm({ name: 'Renamed', icon_url: '' });

    const echo = echoExtensionFromForm(form, publishedExtension);

    expect(echo).toMatchObject({
      id: 'example',
      name: 'Renamed',
      description: 'An example extension.',
      // Base-only content survives: the echo never touches releases.
      releases: publishedExtension.releases,
      version: '0.9.0',
      license: { name: 'MIT', spdx_id: 'MIT' },
      // An empty icon input echoes as absent, not as an empty string.
      icon_url: undefined,
    });
  });

  it('echoes a recognized SPDX license as name and spdx_id', () => {
    const echo = echoExtensionFromForm(extensionForm(), publishedExtension);

    expect(echo.license).toEqual({
      name: 'MIT',
      spdx_id: 'MIT',
      URL: 'https://example.test/license',
    });
  });

  it('echoes the custom-license branch without validating it', () => {
    const echo = echoExtensionFromForm(
      extensionForm({ license_spdx_id: 'other', license_name_custom: 'Mine' }),
      publishedExtension,
    );

    expect(echo.license).toEqual({
      name: 'Mine',
      URL: 'https://example.test/license',
    });
    expect(echo.license).not.toHaveProperty('spdx_id');
  });

  it('never throws on an incomplete license choice', () => {
    // Unlike buildLicense, the echo is a best-effort redisplay: a blank
    // custom name for "other", or an unrecognized selection, must echo
    // as-is rather than reject the redisplay.
    const blankCustom = echoExtensionFromForm(
      extensionForm({ license_spdx_id: 'other', license_name_custom: '' }),
      publishedExtension,
    );
    expect(blankCustom.license).toEqual({
      name: '',
      URL: 'https://example.test/license',
    });

    const unrecognized = echoExtensionFromForm(
      extensionForm({ license_spdx_id: 'not-a-license' }),
      publishedExtension,
    );
    expect(unrecognized.license).toEqual({
      name: '',
      URL: 'https://example.test/license',
    });
  });
});

describe('echoReleaseDraftFromForm', () => {
  it('carries the release-section inputs exactly as typed', () => {
    const form = extensionForm({
      version_tag: '1.1.0',
      release_date: '2026-02-01',
      // No scheme normalization on redisplay: echo what the user typed.
      download_url: 'example.test/1.1.0.zip',
      changelog_url: '',
      min_fossbilling_version: '0.6.0',
    });

    expect(echoReleaseDraftFromForm(form)).toEqual({
      version_tag: '1.1.0',
      release_date: '2026-02-01',
      download_url: 'example.test/1.1.0.zip',
      changelog_url: '',
      min_fossbilling_version: '0.6.0',
    });
  });

  it('returns blank fields when the form omits the release section', () => {
    expect(echoReleaseDraftFromForm(new FormData())).toEqual({
      version_tag: '',
      release_date: '',
      download_url: '',
      changelog_url: '',
      min_fossbilling_version: '',
    });
  });
});

describe('echoNewExtensionFromForm', () => {
  const developer = {
    id: 'developer',
    type: 'organization' as const,
    name: 'Example developer',
  };

  it('builds a blank base with the lowercased form id and echoes the submission', () => {
    const form = extensionForm({
      extension_id: 'Mixed-Case',
      name: 'New name',
      version_tag: '1.0.0',
    });

    const { extension, releaseDraft } = echoNewExtensionFromForm(
      form,
      developer,
    );

    expect(extension).toMatchObject({
      // Lowercased to match what a successful submit would store.
      id: 'mixed-case',
      name: 'New name',
      description: 'An example extension.',
      developer,
      releases: [],
      version: '',
    });
    expect(releaseDraft.version_tag).toBe('1.0.0');
  });

  it('echoes a blank form without throwing', () => {
    const { extension, releaseDraft } = echoNewExtensionFromForm(
      new FormData(),
      developer,
    );

    expect(extension.id).toBe('');
    expect(extension.name).toBe('');
    expect(extension.releases).toEqual([]);
    expect(releaseDraft).toEqual({
      version_tag: '',
      release_date: '',
      download_url: '',
      changelog_url: '',
      min_fossbilling_version: '',
    });
  });
});
