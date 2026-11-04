import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  getMyExtension: vi.fn(),
  getRevision: vi.fn(),
  updateExtension: vi.fn(),
  replacePendingRevision: vi.fn(),
  setFlash: vi.fn(),
}));
vi.mock('@/lib/auth-guard', () => ({ requireUser: mocks.guard }));
vi.mock('@/lib/flash', () => ({ setFlash: mocks.setFlash }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  createApiClient: () => mocks,
}));
import { POST } from '@/pages/extension/[id]/draft';
import { sha256Hex } from '@/lib/hash';
import { editableContent } from '@/lib/extension-draft';
import { ApiRequestError, type ExtensionUpdate } from '@/lib/api/client';
const base: ExtensionUpdate = {
  manifest_version: 1,
  author: { name: 'Author' },
  requires: { fossbilling: '>=0.7.0', php: '>=8.3' },
  type: 'module',
  name: 'Original',
  description: 'Original description',
  homepage_url: 'https://example.test',
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
async function context(overrides: Record<string, unknown> = {}) {
  const body = new FormData();
  body.set(
    'draft',
    JSON.stringify({
      baselineHash: await sha256Hex(JSON.stringify(editableContent(base))),
      sections: { readme: { readme: '# Changed' } },
      ...overrides,
    }),
  );
  return {
    params: { id: 'example' },
    locals: { env: { sessionSecret: 'test' } },
    request: new Request('https://example.test/extension/example/draft', {
      method: 'POST',
      body,
    }),
  } as unknown as APIContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ sub: 'owner' });
  mocks.getMyExtension.mockResolvedValue({
    published: base,
    pending_revision: null,
  });
  mocks.updateExtension.mockResolvedValue({});
});
describe('draft submission', () => {
  it('submits the merged content and returns to the overview', async () => {
    const response = await POST(await context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: '/extension/example',
    });
    expect(mocks.updateExtension).toHaveBeenCalledWith('example', {
      ...base,
      readme: '# Changed',
    });
  });
  it('authorizes before reading any extension content', async () => {
    mocks.guard.mockResolvedValue(new Response(null, { status: 302 }));
    expect((await POST(await context())).status).toBe(302);
    expect(mocks.getMyExtension).not.toHaveBeenCalled();
  });
  it('keeps API ownership enforcement active', async () => {
    mocks.getMyExtension.mockRejectedValue(
      new ApiRequestError(403, 'FORBIDDEN', 'Forbidden'),
    );
    expect((await POST(await context())).status).toBe(403);
    expect(mocks.updateExtension).not.toHaveBeenCalled();
  });
  it('rejects stale baselines and pending submissions without writing', async () => {
    expect((await POST(await context({ baselineHash: 'old' }))).status).toBe(
      409,
    );
    mocks.getMyExtension.mockResolvedValue({
      published: base,
      pending_revision: { id: 'pending' },
    });
    expect((await POST(await context())).status).toBe(409);
    expect(mocks.updateExtension).not.toHaveBeenCalled();
  });
  it('updates pending content while leaving published content alone', async () => {
    mocks.getMyExtension.mockResolvedValue({
      published: { ...base, readme: '# Published' },
      pending_revision: { id: 'pending', content: base },
    });
    const response = await POST(
      await context({ pendingRevisionId: 'pending' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: '/extension/example?version=pending',
    });
    expect(mocks.replacePendingRevision).toHaveBeenCalledWith(
      'example',
      'pending',
      { ...base, readme: '# Changed' },
    );
    expect(mocks.updateExtension).not.toHaveBeenCalled();
  });
  it('edits the first pending submission before anything is published', async () => {
    mocks.getMyExtension.mockResolvedValue({
      published: null,
      pending_revision: { id: 'pending', content: base },
    });
    expect(
      (await POST(await context({ pendingRevisionId: 'pending' }))).status,
    ).toBe(200);
    expect(mocks.replacePendingRevision).toHaveBeenCalled();
  });
  it('keeps stale pending drafts after a review or replacement', async () => {
    expect(
      (await POST(await context({ pendingRevisionId: 'pending' }))).status,
    ).toBe(409);
    mocks.getMyExtension.mockResolvedValue({
      published: base,
      pending_revision: { id: 'new-pending', content: base },
    });
    expect(
      (await POST(await context({ pendingRevisionId: 'pending' }))).status,
    ).toBe(409);
    expect(mocks.updateExtension).not.toHaveBeenCalled();
    expect(mocks.replacePendingRevision).not.toHaveBeenCalled();
  });
  it('handles a concurrent API review without falling back to a fresh submission', async () => {
    mocks.getMyExtension.mockResolvedValue({
      published: base,
      pending_revision: { id: 'pending', content: base },
    });
    mocks.replacePendingRevision.mockRejectedValueOnce(
      new ApiRequestError(409, 'CONFLICT', 'The submission was reviewed'),
    );
    expect(
      (await POST(await context({ pendingRevisionId: 'pending' }))).status,
    ).toBe(409);
    expect(mocks.updateExtension).not.toHaveBeenCalled();
    expect(mocks.setFlash).not.toHaveBeenCalled();
  });
  it('uses the previous rejected submission when nothing was published', async () => {
    mocks.getMyExtension.mockResolvedValue({
      published: null,
      last_review: { revision_id: 'rejected' },
    });
    mocks.getRevision.mockResolvedValue({ content: base });
    expect((await POST(await context())).status).toBe(200);
    expect(mocks.getRevision).toHaveBeenCalledWith('example', 'rejected');
  });
  it('rejects empty changes and malformed section edits', async () => {
    expect((await POST(await context({ sections: {} }))).status).toBe(422);
    expect(
      (await POST(await context({ sections: { readme: { readme: '' } } })))
        .status,
    ).toBe(422);
    expect(mocks.updateExtension).not.toHaveBeenCalled();
  });
  it('returns a recoverable failure when the API is unavailable', async () => {
    mocks.updateExtension.mockRejectedValue(new Error('offline'));
    const response = await POST(await context());
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('draft has been kept');
  });
});
