import { describe, expect, it } from 'vitest';
import {
  buildExtensionCreatePayload as createPayload,
  buildExtensionUpdatePayload,
  ExtensionValidationError,
} from '@/lib/extension-form';
import type { PackageArtifact } from '@/lib/api/client';
import type { Extension } from '@/types';

function extensionForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    readme: '# Example',
    source_url: 'https://github.com/fossbilling/example',
    release_date: '2026-01-01',
    ...overrides,
  }))
    form.set(key, value);
  return form;
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

const artifact: PackageArtifact = {
  id: published.releases[0].artifact_id!,
  source_id: '22222222-2222-4222-8222-222222222222',
  manifest: {
    id: published.identifier,
    manifest_version: 1,
    name: published.name,
    type: published.type,
    description: published.description,
    author: published.author,
    requires: published.requires,
    homepage_url: published.homepage_url,
    license: published.license,
    version: published.version,
  },
  download_url: published.download_url,
  sha256: 'a'.repeat(64),
  created_at: '2026-01-01',
  published_at: null,
};

describe('directory submission forms', () => {
  it('takes listing metadata and release compatibility from the validated ZIP', () => {
    const payload = createPayload(
      extensionForm({ name: 'Ignored', version_tag: '9.0.0' }),
      artifact,
    );
    const { id, ...metadata } = artifact.manifest;
    expect(payload).toMatchObject({ ...metadata, identifier: id });
    expect(payload.releases[0]).toMatchObject({
      requires: artifact.manifest.requires,
      tag: artifact.manifest.version,
      artifact_id: artifact.id,
      sha256: artifact.sha256,
    });
  });
  it('accepts a directory-only description override', () => {
    const payload = createPayload(
      extensionForm({ description: 'Directory description' }),
      artifact,
    );
    expect(payload.description).toBe('Directory description');
    expect(artifact.manifest.description).toBe('Description');
  });
  it('allows moderators to edit the description without changing the release', () => {
    const payload = buildExtensionUpdatePayload(
      extensionForm({
        description: 'Corrected',
        requires_php: '>=8.4',
        download_url: 'https://elsewhere.test/zip',
      }),
      published,
    );
    expect(payload).toMatchObject({
      description: 'Corrected',
      requires: published.requires,
      releases: published.releases,
      download_url: published.download_url,
    });
  });
  it('infers the source host from the single URL field', () => {
    const payload = createPayload(
      extensionForm({ source_url: 'https://gitlab.com/example/source' }),
      artifact,
    );
    expect(payload.source).toEqual({ type: 'gitlab', repo: 'example/source' });
    expect(() =>
      createPayload(
        extensionForm({ source_url: 'ftp://example.test/source' }),
        artifact,
      ),
    ).toThrow(ExtensionValidationError);
  });
});
