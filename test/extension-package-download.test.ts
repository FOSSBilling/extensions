import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getPackage: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@/lib/session', () => ({ getSessionUser: mocks.session }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  createApiClient: () => ({ getPackage: mocks.getPackage }),
  downloadPackage: mocks.download,
}));
import { GET } from '@/pages/package/[packageId]';
import { GET as GET_ICON } from '@/pages/package/[packageId]/icon';
import { ApiRequestError } from '@/lib/api/client';
const context = () =>
  ({
    params: { id: 'example', packageId: 'artifact' },
    locals: { env: { sessionSecret: 'test' } },
    cookies: {},
    request: new Request('http://localhost/package/artifact/icon', {
      headers: { Accept: 'image/avif,image/png' },
    }),
  }) as unknown as APIContext;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ sub: 'owner' });
  mocks.getPackage.mockResolvedValue({ manifest: { id: 'example' } });
  mocks.download.mockImplementation(() =>
    Promise.resolve(
      new Response('zip bytes', {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="example.zip"',
          ETag: '"checksum"',
          'Set-Cookie': 'must-not-forward=1',
        },
      }),
    ),
  );
});
describe('permission-aware package downloads', () => {
  it('streams a private preview with server-side authentication and private cache headers', async () => {
    const response = await GET(context());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('zip bytes');
    expect(mocks.download).toHaveBeenCalledWith(
      expect.anything(),
      'artifact',
      'owner',
      'download',
      undefined,
    );
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Disposition')).toContain(
      'example.zip',
    );
    expect(response.headers.has('Set-Cookie')).toBe(false);
  });
  it('lets the API authorize an anonymous published download', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(context())).status).toBe(200);
    expect(mocks.download).toHaveBeenCalledWith(
      expect.anything(),
      'artifact',
      undefined,
      'download',
      undefined,
    );
  });
  it('keeps unapproved downloads private when the API denies access', async () => {
    mocks.download.mockRejectedValueOnce(
      new ApiRequestError(404, 'NOT_FOUND', 'Private'),
    );
    expect((await GET(context())).status).toBe(404);
  });
});

describe('permission-aware package icons', () => {
  it('forwards icon reads with the owner assertion and sandbox headers', async () => {
    mocks.download.mockResolvedValueOnce(
      new Response('<svg/>', {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Security-Policy': "sandbox; default-src 'none'",
        },
      }),
    );
    const response = await GET_ICON(context());
    expect(mocks.download).toHaveBeenCalledWith(
      expect.anything(),
      'artifact',
      'owner',
      'icon',
      'image/avif,image/png',
    );
    expect(response.headers.get('Content-Security-Policy')).toContain(
      'sandbox',
    );
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(response.headers.get('Vary')).toContain('Accept');
  });
});

it.each([401, 403, 422, 503])(
  'returns appropriate copy for API status %i',
  async (status) => {
    mocks.download.mockRejectedValueOnce(
      new ApiRequestError(status, 'REJECTED', 'Rejected'),
    );
    const response = await GET(context());
    expect(response.status).toBe(status);
    const message = await response.text();
    if (status === 401 || status === 403)
      expect(message).toContain('do not have access');
    else if (status === 503)
      expect(message).toContain('temporarily unavailable');
    else expect(message).not.toContain('try again');
  },
);
it('logs an unexpected proxy failure while keeping the response generic', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const failure = new Error('transport failed');
    mocks.download.mockRejectedValueOnce(failure);
    const response = await GET(context());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(failure.message);
    expect(logged).toHaveBeenCalledWith(expect.any(String), failure);
  } finally {
    logged.mockRestore();
  }
});
