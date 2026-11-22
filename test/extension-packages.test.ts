import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, type ExtensionUpdate } from '@/lib/api/client';
import { MAX_SOURCE_BYTES } from '@/lib/extension-package';
import { editableContent } from '@/lib/extension-draft';
import { sha256Hex } from '@/lib/hash';
const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getMyExtension: vi.fn(),
  getRevision: vi.fn(),
  reservePackage: vi.fn(),
  importGitHubPackage: vi.fn(),
  getPackageJob: vi.fn(),
}));
vi.mock('@/lib/session', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  createApiClient: () => mocks,
}));
import { POST } from '@/pages/extension/[id]/package';
import { GET } from '@/pages/api/package-uploads';

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
async function context(
  options: {
    sourceBytes?: number;
    githubUrl?: string;
    fields?: Record<string, string>;
    baselineHash?: string;
    pending?: boolean;
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
      pendingRevisionId: options.pending ? 'pending' : undefined,
    }),
  );
  form.set(
    'release',
    JSON.stringify(
      options.fields ?? {
        release_date: '2026-11-05',
      },
    ),
  );
  if (options.githubUrl) form.set('github_url', options.githubUrl);
  if (options.sourceBytes !== undefined) {
    form.set('source_bytes', String(options.sourceBytes));
    form.set('source_sha256', 'a'.repeat(64));
  }
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
  mocks.getSessionUser.mockResolvedValue({ sub: 'owner' });
  mocks.getMyExtension.mockResolvedValue({
    published: content,
    pending_revision: null,
  });
  mocks.reservePackage.mockResolvedValue({
    kind: 'upload',
    id: '33333333-3333-4333-8333-333333333333',
    url: 'https://storage.test/zip?signature=test',
    headers: {},
  });
});

describe('release package editor', () => {
  const fields = { original_tag: '1.0.0', release_date: '2026-11-07' };
  it('reserves a ZIP with the extension ID, leaving its version and requirements to the manifest', async () => {
    const response = await POST(await context({ sourceBytes: 128 }));
    expect(response.status).toBe(200);
    expect(mocks.reservePackage).toHaveBeenCalledWith(
      { id: 'example' },
      { bytes: 128, sha256: 'a'.repeat(64) },
    );
    expect(await response.json()).toMatchObject({
      reservation: { kind: 'upload' },
      details: { date: '2026-11-05' },
    });
  });
  it('reserves replacements for a pending release, scoped to its version', async () => {
    mocks.getMyExtension.mockResolvedValue({
      published: null,
      pending_revision: { id: 'pending', content },
    });
    const response = await POST(
      await context({ fields, sourceBytes: 128, pending: true }),
    );
    expect(response.status).toBe(200);
    expect(mocks.reservePackage).toHaveBeenCalledWith(
      { id: 'example', version: '1.0.0' },
      { bytes: 128, sha256: 'a'.repeat(64) },
    );
  });
  it('imports a replacement for the same pending version but rejects it after publication', async () => {
    const githubUrl =
      'https://github.com/example/module/releases/download/v1.0.0/module.zip';
    const job = {
      id: '44444444-4444-4444-8444-444444444444',
      status: 'queued',
    };
    expect((await POST(await context({ fields, githubUrl }))).status).toBe(409);
    expect(mocks.importGitHubPackage).not.toHaveBeenCalled();

    mocks.getMyExtension.mockResolvedValue({
      published: null,
      pending_revision: { id: 'pending', content },
    });
    mocks.importGitHubPackage.mockResolvedValue(job);
    const response = await POST(
      await context({ fields, githubUrl, pending: true }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reservation: { kind: 'job', job },
      details: { date: '2026-11-07' },
    });
    expect(mocks.importGitHubPackage).toHaveBeenCalledWith(githubUrl, {
      id: 'example',
      version: '1.0.0',
    });
    expect(mocks.reservePackage).not.toHaveBeenCalled();
  });
  it('rejects an overlong GitHub ZIP URL before requesting an import', async () => {
    const githubUrl =
      'https://github.com/example/module/releases/download/v1.0.0/' +
      'a'.repeat(2048) +
      '.zip';
    const response = await POST(await context({ githubUrl }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'Enter a GitHub Release ZIP URL of 2,048 characters or fewer.',
    });
    expect(mocks.importGitHubPackage).not.toHaveBeenCalled();
  });
  it('locks a published ZIP but allows changing its date and changelog', async () => {
    expect(
      (await POST(await context({ fields, sourceBytes: 128 }))).status,
    ).toBe(409);
    const response = await POST(
      await context({
        fields: { ...fields, changelog_url: 'https://example.test/changes' },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      release: {
        ...content.releases[0],
        date: '2026-11-07',
        changelog_url: 'https://example.test/changes',
      },
    });
    expect(mocks.reservePackage).not.toHaveBeenCalled();
  });
  it('rejects stale drafts, missing ZIPs, and oversized files before reserving storage', async () => {
    expect(
      (await POST(await context({ baselineHash: 'stale', sourceBytes: 128 })))
        .status,
    ).toBe(409);
    expect((await POST(await context())).status).toBe(422);
    expect(
      (await POST(await context({ sourceBytes: MAX_SOURCE_BYTES + 1 }))).status,
    ).toBe(413);
    expect(mocks.reservePackage).not.toHaveBeenCalled();
  });
  it('authorizes before reading the request or source', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await POST(await context())).status).toBe(401);
    expect(mocks.getMyExtension).not.toHaveBeenCalled();
  });
  it('stops an inactive account before reserving a release', async () => {
    mocks.getMyExtension.mockRejectedValueOnce(
      new ApiRequestError(404, 'not_found', 'Extension not found'),
    );
    expect((await POST(await context({ sourceBytes: 128 }))).status).toBe(404);
    expect(mocks.reservePackage).not.toHaveBeenCalled();
  });
  it('returns a private 404 for a job the signed-in user cannot access', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const url = new URL(`https://site.test/api/package-uploads?jobId=${id}`);
    mocks.getPackageJob.mockRejectedValueOnce(
      new ApiRequestError(404, 'not_found', 'Package job not found'),
    );
    const response = await GET({
      ...(await context()),
      url,
      request: new Request(url),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'Package job not found' });
  });
  it('proxies private progress before the ZIP manifest has been read', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const url = new URL(`https://site.test/api/package-uploads?jobId=${id}`);
    mocks.getPackageJob.mockResolvedValue({
      id,
      extension_identifier: null,
      status: 'queued',
    });
    const ctx = { ...(await context()), url, request: new Request(url) };
    const response = await GET(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      job: { id, status: 'queued', extension_identifier: null },
    });
  });
});
