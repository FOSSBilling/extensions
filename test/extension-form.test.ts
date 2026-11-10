import { describe, expect, it } from 'vitest';
import {
  buildExtensionCreatePayload as createPayload,
  manifestFromCreateForm,
  buildExtensionUpdatePayload,
  echoExtensionFromForm,
  echoNewExtensionFromForm,
  echoReleaseDraftFromForm,
  ExtensionValidationError,
} from '@/lib/extension-form';
import type { Extension } from '@/types';

function extensionForm(overrides: Record<string, string | undefined> = {}) {
  const form = new FormData();
  const values = {
    extension_identifier: 'example_module',
    type: 'module',
    name: 'Example',
    description: 'Description',
    homepage_url: 'example.test',
    author_name: 'Package Author',
    author_url: 'author.example.test',
    requires_fossbilling: '^0.8.9 || ^1.0',
    requires_php: '>=8.3 <9',
    requires_modules: 'branding: ^1.2',
    license_spdx_id: 'MIT',
    readme: '# Example',
    source_url: 'https://github.com/fossbilling/example',
    version_tag: '1.0.0',
    release_date: '2026-01-01',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values))
    if (typeof value === 'string') form.set(key, value);
  return form;
}
function buildExtensionCreatePayload(form: FormData) {
  const manifest = manifestFromCreateForm(form);
  return createPayload(form, {
    id: '11111111-1111-4111-8111-111111111111',
    source_id: '22222222-2222-4222-8222-222222222222',
    manifest,
    download_url: 'https://api.test/packages/download',
    sha256: 'a'.repeat(64),
    created_at: '2026-01-01',
    published_at: null,
  });
}
const developer = {
  id: '019a0000-0000-7000-8000-000000000001',
  identifier: 'owner',
  type: 'organization' as const,
  name: 'Developer',
};
const published: Extension = {
  manifest_version: 1,
  type: 'module',
  name: 'Example',
  description: 'Description',
  author: { name: 'Package Author', url: 'https://author.example.test' },
  requires: {
    fossbilling: '^0.8.9 || ^1.0',
    php: '>=8.3 <9',
    modules: { branding: '^1.2' },
  },
  homepage_url: 'https://example.test',
  license: 'MIT',
  readme: '# Example',
  source: { type: 'github', repo: 'fossbilling/example' },
  version: '1.0.0',
  download_url: 'https://example.test/example.zip',
  releases: [
    {
      tag: '1.0.0',
      artifact_id: '11111111-1111-4111-8111-111111111111',
      sha256: 'a'.repeat(64),
      date: '2026-01-01',
      download_url: 'https://example.test/example.zip',
      requires: {
        fossbilling: '^0.8.9 || ^1.0',
        php: '>=8.3 <9',
        modules: { branding: '^1.2' },
      },
    },
  ],
  id: '019a0000-0000-7000-8000-000000000002',
  identifier: 'example_module',
  developer,
};

describe('manifest publishing forms', () => {
  it('sends the new manifest fields without transforming constraints or attribution', () => {
    const body = buildExtensionCreatePayload(extensionForm());
    expect(body).toMatchObject({
      identifier: 'example_module',
      manifest_version: 1,
      type: 'module',
      license: 'MIT',
      homepage_url: 'https://example.test',
      author: { name: 'Package Author', url: 'https://author.example.test' },
      requires: {
        fossbilling: '^0.8.9 || ^1.0',
        php: '>=8.3 <9',
        modules: { branding: '^1.2' },
      },
    });
    expect(body.releases[0].requires).toEqual(body.requires);
    expect(body).not.toHaveProperty('developer');
    expect(body).not.toHaveProperty('website');
    expect(body.releases[0]).not.toHaveProperty('min_fossbilling_version');
  });
  it('lowercases new identifiers and accepts an omitted homepage', () => {
    const body = buildExtensionCreatePayload(
      extensionForm({ extension_identifier: 'My_Module', homepage_url: '' }),
    );
    expect(body.identifier).toBe('my_module');
    expect(body.homepage_url).toBeUndefined();
  });
  it('aligns the latest release requirements with corrected metadata', () => {
    const body = buildExtensionUpdatePayload(
      extensionForm({ requires_php: '>=8.4' }),
      published,
    );
    expect(body.requires.php).toBe('>=8.4');
    expect(body.releases[0].requires.php).toBe('>=8.4');
    expect(body.releases[0].artifact_id).toBe(
      published.releases[0].artifact_id,
    );
    expect(published.releases[0].requires.php).toBe('>=8.3 <9');
  });
  it('keeps releases and download identity out of moderator form inputs', () => {
    const body = buildExtensionUpdatePayload(
      extensionForm({
        version_tag: '9.0.0',
        download_url: 'https://other.test/zip',
      }),
      published,
    );
    expect(body.version).toBe(published.version);
    expect(body.download_url).toBe(published.download_url);
    expect(body.releases).toHaveLength(1);
  });
  it('requires a stored package for metadata corrections', () => {
    expect(() =>
      buildExtensionUpdatePayload(extensionForm(), {
        ...published,
        releases: [],
      }),
    ).toThrow(/stored package/);
  });
  it('requires an initial release and date for creation', () => {
    expect(() =>
      manifestFromCreateForm(extensionForm({ version_tag: '' })),
    ).toThrow(ExtensionValidationError);
    expect(() =>
      manifestFromCreateForm(extensionForm({ release_date: '' })),
    ).toThrow(ExtensionValidationError);
  });
  it('supports compound SPDX expressions and custom license references', () => {
    for (const license of ['MIT OR Apache-2.0', 'LicenseRef-Acme'])
      expect(
        buildExtensionCreatePayload(
          extensionForm({
            license_spdx_id: 'other',
            license_name_custom: license,
          }),
        ).license,
      ).toBe(license);
    expect(() =>
      buildExtensionCreatePayload(
        extensionForm({ license_spdx_id: 'not-real' }),
      ),
    ).toThrow(ExtensionValidationError);
    expect(() =>
      buildExtensionCreatePayload(
        extensionForm({
          license_spdx_id: 'other',
          license_name_custom: 'invalid/license',
        }),
      ),
    ).toThrow(ExtensionValidationError);
  });
  it('inherits FOSSBilling PHP requirements when no additional constraint is set', () => {
    const body = buildExtensionCreatePayload(
      extensionForm({ requires_php: '' }),
    );
    expect(body.requires).not.toHaveProperty('php');
    expect(body.releases[0].requires).not.toHaveProperty('php');
  });
  it('validates required metadata and dependency syntax without losing ranges', () => {
    for (const overrides of [
      { author_name: '' },
      { requires_fossbilling: '' },
      { type: 'mod' },
      { source_url: 'ftp://example.test/source' },
      { requires_modules: 'bad/name: ^1' },
      { requires_modules: 'branding: ^1\nbranding: ^2' },
    ] satisfies Record<string, string>[])
      expect(() =>
        buildExtensionCreatePayload(extensionForm(overrides)),
      ).toThrow(ExtensionValidationError);
  });
  it('preserves submitted fields and invalid dependency input on error', () => {
    const form = extensionForm({
      name: 'Changed',
      requires_modules: 'unfinished dependency',
      license_spdx_id: 'other',
      license_name_custom: 'MIT OR BSD-3-Clause',
    });
    const echo = echoExtensionFromForm(form, published);
    expect(echo.name).toBe('Changed');
    expect(echo.author.name).toBe('Package Author');
    expect(echo.moduleRequirementsInput).toBe('unfinished dependency');
    expect(echo.license).toBe('MIT OR BSD-3-Clause');
    expect(echoReleaseDraftFromForm(form).version_tag).toBe('1.0.0');
    const createdEcho = echoNewExtensionFromForm(form, developer).extension;
    expect(createdEcho).not.toHaveProperty('id');
    expect(createdEcho.identifier).toBe('example_module');
  });
});

it('rejects a blank custom license but safely echoes incomplete edits', () => {
  const form = extensionForm({
    license_spdx_id: 'other',
    license_name_custom: '',
    version_tag: '',
    author_url: '',
  });
  expect(() =>
    buildExtensionCreatePayload(
      extensionForm({ license_spdx_id: 'other', license_name_custom: '' }),
    ),
  ).toThrow(/license/i);
  expect(() => buildExtensionUpdatePayload(form, published)).toThrow(
    /license/i,
  );
  const echo = echoExtensionFromForm(form, published);
  expect(echo.license).toBe('');
  expect(echo.author.url).toBeUndefined();
});

it('safely echoes blank new-extension and release submissions', () => {
  const form = new FormData();
  expect(echoReleaseDraftFromForm(form)).toEqual({
    version_tag: '',
    release_date: '',
    changelog_url: '',
  });
  const echo = echoNewExtensionFromForm(form, developer);
  expect(echo.extension).toMatchObject({
    identifier: '',
    name: '',
    license: '',
    moduleRequirementsInput: '',
    author: { name: '' },
  });
  expect(echo.releaseDraft).toEqual(echoReleaseDraftFromForm(form));
});

it('infers the source host from the single URL field', () => {
  const payload = buildExtensionCreatePayload(
    extensionForm({ source_url: 'https://gitlab.com/example/source' }),
  );
  expect(payload.source).toEqual({ type: 'gitlab', repo: 'example/source' });
});
