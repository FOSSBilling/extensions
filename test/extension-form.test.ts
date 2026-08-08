import { describe, expect, it } from 'vitest';
import {
  buildExtensionCreatePayload,
  buildExtensionUpdatePayload,
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
  form.set('license_name', 'MIT');
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
  license: { name: 'MIT' },
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
