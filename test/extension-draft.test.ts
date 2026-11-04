import { describe, expect, it } from 'vitest';
import {
  applyExtensionDraft,
  editableContent,
  reconstructionContent,
  releaseFromFields,
  serializeDraftConfig,
  type ExtensionDraft,
} from '@/lib/extension-draft';
import type { ExtensionUpdate } from '@/lib/api/client';

export const base: ExtensionUpdate = {
  manifest_version: 1,
  author: { name: 'Author' },
  requires: { fossbilling: '>=0.7.0', php: '>=8.3' },
  type: 'module',
  name: 'Original',
  description: 'Original description',
  homepage_url: 'http://example.test',
  icon_url: 'icon.svg',
  readme: '# Original',
  license: 'MIT',
  source: { type: 'github', repo: 'example/original' },
  releases: [
    {
      tag: '1.0.0',
      date: '2026-01-01',
      download_url: 'https://example.test/1.zip',
      requires: { fossbilling: '>=0.7.0', php: '>=8.3' },
    },
  ],
  version: '1.0.0',
  download_url: 'https://example.test/1.zip',
};
const draft = (sections: ExtensionDraft['sections']): ExtensionDraft => ({
  baselineHash: 'hash',
  sections,
});

describe('extension drafts', () => {
  it('saves source and license with the merged Listing section while retaining README and releases', () => {
    const result = applyExtensionDraft(
      base,
      draft({
        listing: {
          author_name: 'Author',
          requires_fossbilling: '>=0.7.0',
          requires_php: '>=8.3',
          name: 'Updated Listing',
          description: 'Updated description',
          type: 'module',
          homepage_url: 'https://example.test',
          icon_url: '',
          source_url: 'https://gitlab.com/example/updated',
          license_spdx_id: 'Apache-2.0',
          license_url: 'https://example.test/license',
        },
      }),
    );
    expect(result.name).toBe('Updated Listing');
    expect(result.source).toEqual({ type: 'gitlab', repo: 'example/updated' });
    expect(result.license).toBe('Apache-2.0');
    expect(result.readme).toBe(base.readme);
    expect(result.releases).toEqual(base.releases);
    expect(result.version).toBe(base.version);
  });
  it('merges multiple edited sections without replacing unrelated fields or releases', () => {
    const result = applyExtensionDraft(
      base,
      draft({
        readme: { readme: '# Revised' },
        listing: {
          author_name: 'Author',
          requires_fossbilling: '>=0.7.0',
          requires_php: '>=8.3',
          name: 'Revised',
          description: 'Revised description',
          type: 'theme',
          homepage_url: 'https://example.test/new',
          icon_url: '',
        },
      }),
    );
    expect(result).toMatchObject({
      name: 'Revised',
      type: 'theme',
      readme: '# Revised',
    });
    expect(result.icon_url).toBeUndefined();
    expect(result.releases).toEqual(base.releases);
    expect(result.version).toBe(base.version);
    expect(result.download_url).toBe(base.download_url);
    expect(result.source).toEqual(base.source);
    expect(base.name).toBe('Original');
  });
  it('preserves untouched HTTP URLs exactly', () => {
    expect(
      applyExtensionDraft(base, draft({ readme: { readme: '# Changed' } }))
        .homepage_url,
    ).toBe('http://example.test');
  });
  it('ignores attempts to overwrite other fields inside an edited section', () => {
    const result = applyExtensionDraft(
      base,
      draft({
        readme: {
          readme: '# Changed',
          name: 'Injected',
          developer_id: 'another',
          releases: '[]',
        },
      }),
    );
    expect(result.name).toBe(base.name);
    expect(result.releases).toEqual(base.releases);
    expect(result).not.toHaveProperty('developer_id');
  });
  it('keeps custom licensing and source edits isolated from listing content', () => {
    const result = applyExtensionDraft(
      base,
      draft({
        details: {
          source_type: 'custom',
          source_repo: 'https://example.test/source',
          license_spdx_id: 'other',
          license_name_custom: 'Commercial',
          license_url: 'https://example.test/license',
        },
      }),
    );
    expect(result.license).toBe('Commercial');
    expect(result.name).toBe(base.name);
    expect(result.readme).toBe(base.readme);
  });
  it('derives the latest version and download automatically, ignoring an old manual selection', () => {
    const next = {
      ...base.releases[0],
      tag: '2.0.0',
      download_url: 'https://example.test/2.zip',
    };
    const result = applyExtensionDraft(base, {
      ...draft({}),
      releases: [...base.releases, next],
      currentRelease: '1.0.0',
      download_url: 'https://injected.test',
    });
    expect(result.version).toBe('2.0.0');
    expect(result.download_url).toBe(next.download_url);
    expect(result.name).toBe(base.name);
  });

  it('automatically selects the next release when the latest is removed', () => {
    const newer = {
      ...base.releases[0],
      tag: '2.0.0',
      download_url: 'https://example.test/2.zip',
    };
    const published = {
      ...base,
      releases: [...base.releases, newer],
      version: '2.0.0',
      download_url: newer.download_url,
    };
    const result = applyExtensionDraft(published, {
      ...draft({}),
      releases: base.releases,
    });
    expect(result.version).toBe('1.0.0');
    expect(result.download_url).toBe(base.download_url);
  });
  it('updates the primary download when the latest release is edited', () => {
    const changed = {
      ...base.releases[0],
      download_url: 'https://example.test/fixed.zip',
    };
    const result = applyExtensionDraft(base, {
      ...draft({}),
      releases: [changed],
    });
    expect(result.download_url).toBe(changed.download_url);
    expect(result.version).toBe('1.0.0');
  });
  it('normalizes a stale primary release when other draft sections are submitted', () => {
    const newer = {
      ...base.releases[0],
      tag: '2.0.0',
      download_url: 'https://example.test/2.zip',
    };
    const result = applyExtensionDraft(
      { ...base, releases: [...base.releases, newer] },
      draft({ readme: { readme: '# Edited' } }),
    );
    expect(result.version).toBe('2.0.0');
    expect(result.download_url).toBe(newer.download_url);
  });
  it('keeps the version label and untouched historic release values when editing another release', () => {
    const published = {
      ...base,
      releases: [
        {
          ...base.releases[0],
          tag: 'v1.0.0',
          date: '2026-01-01T12:00:00Z',
          download_url: 'http://example.test/1.zip',
        },
      ],
      download_url: 'http://example.test/1.zip',
    };
    const next = {
      ...base.releases[0],
      tag: '0.9.0',
      download_url: 'https://example.test/old.zip',
    };
    const result = applyExtensionDraft(published, {
      ...draft({}),
      releases: [...published.releases, next],
      currentRelease: 'v1.0.0',
    });
    expect(result.version).toBe('1.0.0');
    expect(result.releases[0]).toEqual(published.releases[0]);
    expect(result.download_url).toBe('http://example.test/1.zip');
  });
  it.each([
    { releases: [], currentRelease: '' },
    { releases: [base.releases[0], base.releases[0]], currentRelease: '1.0.0' },
    {
      releases: new Array(101).fill(base.releases[0]),
      currentRelease: '1.0.0',
    },
  ])('rejects invalid release sets: %j', (releases) => {
    expect(() =>
      applyExtensionDraft(base, { ...draft({}), ...releases }),
    ).toThrow();
  });
  it.each([
    null,
    { sections: [] },
    { sections: { unknown: {} } },
    { sections: { readme: { readme: '' } } },
    { sections: { details: { source_type: 'invalid' } } },
  ])('rejects invalid draft input: %j', (input) => {
    expect(() => applyExtensionDraft(base, input)).toThrow();
  });
  it('rejects impossible release dates and invalid URLs', () => {
    const fields = {
      version_tag: '2.0.0',
      release_date: '2026-02-30',
      download_url: 'https://example.test/2.zip',
      requires: { fossbilling: '>=0.7.0', php: '>=8.3' },
    };
    expect(() => releaseFromFields(fields)).toThrow('date');
    expect(() =>
      releaseFromFields({
        ...fields,
        release_date: '2026-02-28',
        download_url: 'https://%',
      }),
    ).toThrow('URL');
  });
  it('does not treat incomplete historical content as an editable baseline', () => {
    expect(editableContent({ name: 'Historical name' })).toBeNull();
    expect(
      editableContent({ ...base, id: 'immutable', developer: {} }),
    ).toEqual(base);
    expect(editableContent({ ...base, source: null })).toBeNull();
  });
  it('keeps available historical fields when rebuilding an incomplete submission', () => {
    const reconstructed = reconstructionContent({
      name: 'Historical name',
      readme: '# Retained',
    });
    expect(reconstructed).toMatchObject({
      name: 'Historical name',
      readme: '# Retained',
      releases: [],
      source: { type: 'github', repo: '' },
    });
    expect(
      applyExtensionDraft(
        reconstructed,
        draft({ readme: { readme: '# Revised' } }),
      ).name,
    ).toBe('Historical name');
  });
});

describe('draft configuration embedded in HTML', () => {
  it('preserves README HTML and script-like text when parsed in the browser', () => {
    const config = {
      base: {
        readme:
          '# README\n<div>Unicode 🦊 & HTML</div>\n</script><script>example()</script>',
      },
    };
    const serialized = serializeDraftConfig(config);
    expect(serialized).not.toContain('<');
    expect(JSON.parse(serialized)).toEqual(config);
  });
});

describe('manifest fields in section drafts', () => {
  it('preserves opaque requirements and author attribution across unrelated edits', () => {
    const manifest = {
      ...base,
      author: { name: 'Package Author', url: 'https://author.example.test' },
      requires: {
        fossbilling: '^0.8.9 || ^1.0',
        php: '>=8.3 <9',
        modules: { branding: '^1.2' },
      },
    };
    const result = applyExtensionDraft(
      manifest,
      draft({ readme: { readme: '# Revised' } }),
    );
    expect(result.author).toEqual(manifest.author);
    expect(result.requires).toEqual(manifest.requires);
  });
  it('saves release-specific requirements without rewriting constraints', () => {
    const release = releaseFromFields({
      version_tag: '2.0.0',
      release_date: '2026-11-04',
      download_url: 'https://example.test/2.zip',
      requires_fossbilling: '^0.8.9 || ^1.0',
      requires_php: '>=8.3 <9',
      requires_modules: 'branding: ^1.2',
    });
    expect(release.requires).toEqual({
      fossbilling: '^0.8.9 || ^1.0',
      php: '>=8.3 <9',
      modules: { branding: '^1.2' },
    });
  });
  it('does not invent compatibility requirements when rebuilding old submissions', () => {
    const reconstructed = reconstructionContent({
      name: 'Old',
      releases: [
        {
          tag: '1.0.0',
          date: '2026-01-01',
          download_url: 'https://example.test/1.zip',
          min_fossbilling_version: '0.7.0',
        },
      ],
    });
    expect(reconstructed.requires).toEqual({ fossbilling: '', php: '' });
    expect(reconstructed.releases[0].requires).toEqual({
      fossbilling: '',
      php: '',
    });
  });
});
