import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  getRevision: vi.fn(),
  getModerationExtension: vi.fn(),
}));
vi.mock('@/lib/auth-guard', () => ({ requireModerator: mocks.guard }));
vi.mock('@/lib/api/client', () => ({
  createApiClient: () => ({
    getRevision: mocks.getRevision,
    getModerationExtension: mocks.getModerationExtension,
  }),
  apiErrorResponse: () => new Response(null, { status: 503 }),
}));
import { GET } from '@/pages/api/admin/revision-detail';

const context = (query: string) =>
  ({
    url: new URL(`https://example.test/api/admin/revision-detail?${query}`),
    locals: { env: {} },
  }) as APIContext;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ sub: 'moderator' });
  mocks.getRevision.mockResolvedValue({
    extension_id: 'ext',
    content_available: true,
    content: { name: 'Proposed' },
  });
  mocks.getModerationExtension.mockResolvedValue({
    published: { name: 'Live' },
  });
});
describe('on-demand revision proxy', () => {
  it('authorizes before issuing any content query', async () => {
    mocks.guard.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await GET(context('extensionId=ext&revisionId=rev'))).status).toBe(
      403,
    );
    expect(mocks.getRevision).not.toHaveBeenCalled();
  });
  it('requires a revision ID instead of expanding all history', async () => {
    expect((await GET(context('extensionId=ext'))).status).toBe(422);
    expect(mocks.getRevision).not.toHaveBeenCalled();
  });
  it('fetches only one frozen revision unless comparison was requested', async () => {
    const response = await GET(context('extensionId=ext&revisionId=rev'));
    expect(response.status).toBe(200);
    expect(mocks.getRevision).toHaveBeenCalledExactlyOnceWith('ext', 'rev');
    expect(mocks.getModerationExtension).not.toHaveBeenCalled();
    await GET(context('extensionId=ext&revisionId=rev&compare=1'));
    expect(mocks.getModerationExtension).toHaveBeenCalledExactlyOnceWith('ext');
  });
  it('reports compacted content without fetching live content', async () => {
    mocks.getRevision.mockResolvedValue({
      content_available: false,
      compacted_at: '2026-01-01',
      content: null,
    });
    expect(
      (await GET(context('extensionId=ext&revisionId=rev&compare=1'))).status,
    ).toBe(409);
    expect(mocks.getModerationExtension).not.toHaveBeenCalled();
  });
});
