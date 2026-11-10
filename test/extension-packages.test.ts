import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionUpdate, PackageArtifact } from '@/lib/api/client';
import { packageManifest, rebuildLatestPackage } from '@/lib/extension-package';
import { editableContent, applyExtensionDraft } from '@/lib/extension-draft';
import { sha256Hex } from '@/lib/hash';
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  getMyExtension: vi.fn(),
  getRevision: vi.fn(),
  getPackage: vi.fn(),
  buildPackage: vi.fn(),
  queuePackage: vi.fn(),
  getPackageJob: vi.fn(),
}));
vi.mock('@/lib/auth-guard', () => ({ requireUser: mocks.guard }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  createApiClient: () => mocks,
}));
import { GET, POST } from '@/pages/extension/[id]/package';

const content: ExtensionUpdate = {
  manifest_version: 1,
  name: 'Example',
  description: 'Original description',
  type: 'module',
  author: { name: 'Author' },
  license: 'MIT',
  requires: { fossbilling: '>=0.8.0' },
  readme: '# Example',
  source: { type: 'github', repo: 'example/module' },
  version: '1.0.0',
  download_url: 'https://api.test/original.zip',
  releases: [
    {
      tag: '1.0.0',
      date: '2026-11-05',
      download_url: 'https://api.test/original.zip',
      requires: { fossbilling: '>=0.8.0' },
      artifact_id: '11111111-1111-4111-8111-111111111111',
      sha256: 'a'.repeat(64),
    },
  ],
};
const original: PackageArtifact = {
  id: content.releases[0].artifact_id!,
  source_id: '22222222-2222-4222-8222-222222222222',
  manifest: packageManifest('example', content),
  download_url: content.download_url,
  sha256: 'a'.repeat(64),
  created_at: '2026-11-05',
  published_at: '2026-11-05',
};
const artifact: PackageArtifact = {
  ...original,
  id: '33333333-3333-4333-8333-333333333333',
  manifest: { ...original.manifest, version: '1.1.0' },
  sha256: 'b'.repeat(64),
  download_url: 'https://api.test/built.zip',
  published_at: null,
};
async function context(
  options: {
    source?: File;
    fields?: Record<string, string>;
    baselineHash?: string;
    releases?: ExtensionUpdate['releases'];
  } = {},
) {
  const form = new FormData();
  form.set(
    'draft',
    JSON.stringify({
      baselineHash:
        options.baselineHash ??
        (await sha256Hex(JSON.stringify(editableContent(content)))),
      sections: {},
      releases: options.releases,
    }),
  );
  form.set(
    'release',
    JSON.stringify(
      options.fields ?? {
        version_tag: '1.1.0',
        release_date: '2026-11-05',
        requires_fossbilling: '>=0.8.0',
      },
    ),
  );
  if (options.source) form.set('source', options.source);
  return {
    params: { id: 'example' },
    locals: { env: {} },
    request: new Request('https://site.test/extension/example/package', {
      method: 'POST',
      body: form,
    }),
  } as unknown as APIContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ sub: 'owner' });
  mocks.getMyExtension.mockResolvedValue({
    published: content,
    pending_revision: null,
  });
  mocks.getPackage.mockResolvedValue(original);
  mocks.buildPackage.mockResolvedValue(artifact);
  mocks.queuePackage.mockResolvedValue({
    id: '44444444-4444-4444-8444-444444444444',
    extension_identifier: 'example',
    status: 'queued',
    artifact: null,
    error: null,
    created_at: 'now',
    updated_at: 'now',
  });
});

describe('release package editor', () => {
  it('builds an uploaded ZIP with the current draft manifest and returns a queued job', async () => {
    const file = new File(['synthetic source'], 'module.zip');
    const response = await POST(await context({ source: file }));
    expect(response.status).toBe(202);
    expect(mocks.queuePackage).toHaveBeenCalledWith(
      { ...original.manifest, version: '1.1.0' },
      expect.any(File),
    );
    expect(await response.json()).toMatchObject({
      job: { status: 'queued' },
      release: {
        tag: '1.1.0',
      },
    });
  });
  it('reuses the authorized source for compatibility edits', async () => {
    const response = await POST(
      await context({
        fields: {
          original_tag: '1.0.0',
          version_tag: '1.0.0',
          release_date: '2026-11-05',
          requires_fossbilling: '>=0.9.0',
        },
      }),
    );
    expect(response.status).toBe(202);
    expect(mocks.getPackage).toHaveBeenCalledWith(original.id);
    expect(mocks.queuePackage).toHaveBeenCalledWith(
      { ...original.manifest, requires: { fossbilling: '>=0.9.0' } },
      { sourceId: original.source_id },
    );
  });
  it('keeps an older package’s own metadata when only its compatibility changes', async () => {
    const newer = {
      ...content,
      name: 'Newer Name',
      version: '2.0.0',
      releases: [
        { ...content.releases[0], tag: '2.0.0', artifact_id: artifact.id },
        ...content.releases,
      ],
    };
    mocks.getMyExtension.mockResolvedValue({
      published: newer,
      pending_revision: null,
    });
    const response = await POST(
      await context({
        baselineHash: await sha256Hex(JSON.stringify(editableContent(newer))),
        fields: {
          original_tag: '1.0.0',
          version_tag: '1.0.0',
          release_date: '2026-11-05',
          requires_fossbilling: '>=0.9.0',
        },
      }),
    );
    expect(response.status).toBe(202);
    expect(mocks.queuePackage).toHaveBeenCalledWith(
      { ...original.manifest, requires: { fossbilling: '>=0.9.0' } },
      { sourceId: original.source_id },
    );
  });
  it('rejects stale drafts, missing ZIPs, duplicate versions and oversize files before building', async () => {
    expect(
      (
        await POST(
          await context({
            baselineHash: 'stale',
            source: new File(['zip'], 'module.zip'),
          }),
        )
      ).status,
    ).toBe(409);
    expect((await POST(await context())).status).toBe(422);
    expect(
      (
        await POST(
          await context({
            fields: {
              version_tag: '1.0.0',
              release_date: '2026-11-05',
              requires_fossbilling: '>=0.8.0',
            },
            source: new File(['zip'], 'module.zip'),
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await POST(
          await context({
            source: new File(
              [new Uint8Array(5 * 1024 * 1024 + 1)],
              'module.zip',
            ),
          }),
        )
      ).status,
    ).toBe(413);
    expect(mocks.queuePackage).not.toHaveBeenCalled();
  });
  it('requires a ZIP when a release has no stored package', async () => {
    const unprepared = {
      ...content,
      releases: content.releases.map(
        ({ artifact_id: _id, sha256: _hash, ...release }) => release,
      ),
    };
    mocks.getMyExtension.mockResolvedValue({
      published: unprepared,
      pending_revision: null,
    });
    const response = await POST(
      await context({
        baselineHash: await sha256Hex(
          JSON.stringify(editableContent(unprepared)),
        ),
        fields: {
          original_tag: '1.0.0',
          version_tag: '1.0.0',
          release_date: '2026-11-05',
          requires_fossbilling: '>=0.8.0',
        },
      }),
    );
    expect(response.status).toBe(422);
    expect(mocks.queuePackage).not.toHaveBeenCalled();
  });
  it('proxies private job progress and rejects another extension’s job', async () => {
    const ctx = await context();
    const id = '44444444-4444-4444-8444-444444444444';
    ctx.url = new URL(
      `https://site.test/extension/example/package?jobId=${id}`,
    );
    mocks.getPackageJob.mockResolvedValue({
      id,
      extension_identifier: 'example',
      status: 'queued',
    });
    const response = await GET(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      job: { id, status: 'queued' },
    });
    mocks.getPackageJob.mockResolvedValue({
      id,
      extension_identifier: 'another',
      status: 'queued',
    });
    expect((await GET(ctx)).status).toBe(404);
  });
  it('authorizes before reading the request or source', async () => {
    mocks.guard.mockResolvedValue(new Response(null, { status: 302 }));
    expect((await POST(await context())).status).toBe(302);
    expect(mocks.getMyExtension).not.toHaveBeenCalled();
  });
  it('preserves artifact references when a release is changed in a browser draft', () => {
    const release = {
      ...content.releases[0],
      changelog_url: 'https://example.test/changelog',
    };
    const result = applyExtensionDraft(content, {
      sections: {},
      releases: [release],
    });
    expect(result.releases[0]).toMatchObject({
      artifact_id: original.id,
      sha256: original.sha256,
      changelog_url: release.changelog_url,
    });
  });
});

describe('overview package rebuilds', () => {
  it('preserves packages for directory-only changes', async () => {
    const changed = {
      ...content,
      readme: '# Updated',
      source: { type: 'custom' as const, repo: 'https://example.test/source' },
    };
    expect(await rebuildLatestPackage(mocks, 'example', changed)).toBe(changed);
    expect(mocks.buildPackage).not.toHaveBeenCalled();
  });
  it('rebuilds the latest package for changed manifest metadata without modifying older releases', async () => {
    const changed = {
      ...content,
      description: 'Corrected description',
      releases: [
        ...content.releases,
        {
          tag: '0.9.0',
          date: '2026-01-01',
          download_url: 'https://old.test/zip',
          requires: { fossbilling: '>=0.7.0' },
        },
      ],
    };
    mocks.buildPackage.mockResolvedValue({
      ...artifact,
      manifest: { ...original.manifest, description: changed.description },
    });
    const result = await rebuildLatestPackage(mocks, 'example', changed);
    expect(mocks.buildPackage).toHaveBeenCalledWith(
      { ...original.manifest, description: changed.description },
      { sourceId: original.source_id },
    );
    expect(result.releases[0].artifact_id).toBe(artifact.id);
    expect(result.releases[1]).toBe(changed.releases[1]);
    expect(result.version).toBe('1.0.0');
    expect(result.download_url).toBe(artifact.download_url);
  });
  it('retains the draft content on a rebuild failure', async () => {
    const changed = { ...content, name: 'Changed' };
    mocks.buildPackage.mockRejectedValue(new Error('Storage unavailable'));
    await expect(
      rebuildLatestPackage(mocks, 'example', changed),
    ).rejects.toThrow('Storage unavailable');
    expect(changed.releases[0].artifact_id).toBe(original.id);
    expect(changed.download_url).toBe(original.download_url);
  });
});

it('rejects browser artifacts for another extension or version before queuing work', async () => {
  const foreign = '55555555-5555-4555-8555-555555555555';
  for (const manifest of [
    { ...original.manifest, id: 'another-extension' },
    { ...original.manifest, version: '2.0.0' },
  ]) {
    mocks.getPackage.mockResolvedValueOnce({
      ...original,
      id: foreign,
      manifest,
    });
    const response = await POST(
      await context({
        releases: [{ ...content.releases[0], artifact_id: foreign }],
        fields: {
          original_tag: '1.0.0',
          version_tag: '1.0.0',
          release_date: '2026-11-05',
          requires_fossbilling: '>=0.8.0',
        },
      }),
    );
    expect(response.status).toBe(409);
    expect(mocks.queuePackage).not.toHaveBeenCalled();
  }
});
it('reuses a package prepared in the local draft before it has been submitted', async () => {
  const sourceId = '66666666-6666-4666-8666-666666666666';
  mocks.getPackage.mockResolvedValueOnce({ ...artifact, source_id: sourceId });
  const response = await POST(
    await context({
      releases: [
        {
          ...content.releases[0],
          tag: '1.1.0',
          artifact_id: artifact.id,
          download_url: artifact.download_url,
          sha256: artifact.sha256,
        },
      ],
      fields: {
        original_tag: '1.1.0',
        version_tag: '1.1.0',
        release_date: '2026-11-05',
        requires_fossbilling: '>=0.8.0',
      },
    }),
  );
  expect(response.status).toBe(202);
  expect(mocks.queuePackage).toHaveBeenCalledWith(artifact.manifest, {
    sourceId,
  });
});
