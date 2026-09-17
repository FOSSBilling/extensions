import { describe, expect, it } from 'vitest';
import { countChangedRows, diffRevisionContent } from '@/lib/revision-diff';
import type {
  ExtensionContent,
  StoredExtensionContent,
} from '@/lib/api/generated/extensions-v2/types.gen';

const published: ExtensionContent = {
  type: 'mod',
  name: 'Old name',
  version: '1.0.0',
  description: 'Old description',
  website: 'https://example.test',
  license: { name: 'MIT', spdx_id: 'MIT' },
  source: { type: 'github', repo: 'org/old' },
  download_url: 'https://example.test/old.zip',
  icon_url: 'https://example.test/icon.png',
  readme: 'Old readme',
  releases: [
    {
      tag: 'v1.0.0',
      date: '2026-01-01',
      download_url: 'https://example.test/old.zip',
      min_fossbilling_version: '0.1.0',
    },
  ],
};

describe('diffRevisionContent', () => {
  it('marks changed fields and keeps unchanged ones explicit', () => {
    const revision: StoredExtensionContent = {
      ...published,
      name: 'New name',
      version: '1.1.0',
    };
    const rows = diffRevisionContent(published, revision);

    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.name.changed).toBe(true);
    expect(byField.name.oldValue).toBe('Old name');
    expect(byField.name.newValue).toBe('New name');
    expect(byField.type.changed).toBe(false);
    expect(countChangedRows(rows)).toBe(2);
  });

  it('treats a missing published version as a new extension', () => {
    const rows = diffRevisionContent(null, { name: 'Brand new' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.name.isNew).toBe(true);
    expect(byField.name.changed).toBe(true);
    expect(byField.name.oldValue).toBeNull();
    expect(byField.website.changed).toBe(false);
  });

  it('compares license, source and releases by label rather than object identity', () => {
    const revision: StoredExtensionContent = {
      ...published,
      license: { name: 'MIT', spdx_id: 'MIT' },
      source: { type: 'github', repo: 'org/old' },
      releases: published.releases.map((r) => ({ ...r })),
    };
    const rows = diffRevisionContent(published, revision);
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.license.changed).toBe(false);
    expect(byField.source.changed).toBe(false);
    expect(byField.releases.changed).toBe(false);
  });

  it('marks a license URL-only change as changed and exposes both URLs', () => {
    const rows = diffRevisionContent(published, {
      ...published,
      license: {
        name: 'MIT',
        spdx_id: 'MIT',
        URL: 'https://example.test/licenses/mit',
      },
    });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.license.changed).toBe(true);
    expect(byField.license.oldValue).toBe('MIT (MIT)');
    expect(byField.license.newValue).toBe('MIT (MIT)');
    expect(byField.license.oldUrl).toBeNull();
    expect(byField.license.newUrl).toBe('https://example.test/licenses/mit');
    expect(countChangedRows(rows)).toBe(1);
  });

  it('marks a repository host-only change as changed', () => {
    const rows = diffRevisionContent(published, {
      ...published,
      source: { type: 'gitlab', repo: 'org/old' },
    });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.source.changed).toBe(true);
    expect(byField.source.oldValue).toBe('org/old');
    expect(byField.source.newValue).toBe('org/old');
    expect(byField.source.oldUrl).toBe('https://github.com/org/old');
    expect(byField.source.newUrl).toBe('https://gitlab.com/org/old');
  });

  it('carries type-aware repository URLs on the source row', () => {
    const rows = diffRevisionContent(published, {
      ...published,
      source: { type: 'gitlab', repo: 'org/new' },
    });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.source.changed).toBe(true);
    expect(byField.source.oldUrl).toBe('https://github.com/org/old');
    expect(byField.source.newUrl).toBe('https://gitlab.com/org/new');
    expect(byField.name.oldUrl).toBeNull();
    expect(byField.name.newUrl).toBeNull();
  });

  it('leaves source URLs empty when either side has no source', () => {
    const rows = diffRevisionContent(null, { name: 'Brand new' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.source.oldUrl).toBeNull();
    expect(byField.source.newUrl).toBeNull();
  });

  it('keeps the surviving side URL when only one side has a source', () => {
    const withoutSource = { ...published, source: undefined };
    const added = diffRevisionContent(withoutSource, published);
    expect(added.find((r) => r.field === 'source')?.oldUrl).toBeNull();
    expect(added.find((r) => r.field === 'source')?.newUrl).toBe(
      'https://github.com/org/old',
    );

    const removed = diffRevisionContent(published, withoutSource);
    expect(removed.find((r) => r.field === 'source')?.oldUrl).toBe(
      'https://github.com/org/old',
    );
    expect(removed.find((r) => r.field === 'source')?.newUrl).toBeNull();
  });
});
