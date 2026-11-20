import type { APIContext } from 'astro';
import { fieldUrl } from '@/lib/revision-diff-shared';
import {
  packageDownloadPath,
  isPackageDownloadPath,
  isSafeDiffHref,
} from '@/lib/package-download';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient, downloadPackage } from '@/lib/api/client';
import { makeEnv } from './helpers/env';
import { fakeCookies } from './helpers/fake-cookies';
import { createSessionCookieValue, SESSION_COOKIE } from '@/lib/session';
import { POST, PUT } from '@/pages/api/package-uploads';
import type { Manifest } from '@/lib/api/client';
const manifest: Manifest = {
  manifest_version: 1,
  id: 'example',
  name: 'Example',
  type: 'module',
  description: 'Example',
  version: '1.0.0',
  author: { name: 'Developer' },
  license: 'MIT',
  requires: { fossbilling: '>=0.8.0' },
};
describe('package API transport', () => {
  it('forwards authenticated reservations and confirmations from the directory handlers', async () => {
    const source = { bytes: 5 * 1024 * 1024, sha256: 'a'.repeat(64) };
    const reservation = {
      kind: 'upload',
      id: '11111111-1111-4111-8111-111111111111',
      url: 'https://storage.test/zip?signature=test',
      headers: {},
    };
    const job = {
      id: '44444444-4444-4444-8444-444444444444',
      extension_identifier: 'example',
      status: 'queued',
      artifact: null,
      error: null,
      created_at: '2026-11-20T12:00:00Z',
      updated_at: '2026-11-20T12:00:00Z',
    };
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.headers.get('Authorization')).toMatch(/^Bearer /);
      expect(request.headers.get('Content-Type')).toContain('application/json');
      if (request.url.endsWith('/package-uploads')) {
        expect(await request.json()).toEqual({ manifest, ...source });
        return Response.json({ result: reservation });
      }
      expect(request.url).toBe('https://api.test/extensions/v2/packages');
      expect(await request.json()).toEqual({ upload_id: reservation.id });
      return Response.json({ result: job }, { status: 202 });
    });
    const env = makeEnv({
      extensionsApi: {
        baseUrl: 'https://api.test',
        fetch: fetcher as typeof fetch,
      },
    });
    const { cookies, jar } = fakeCookies();
    const context = (method: string, values: Record<string, string>) => {
      const body = new FormData();
      for (const [key, value] of Object.entries(values)) body.set(key, value);
      return {
        request: new Request('https://site.test/api/package-uploads', {
          method,
          body,
        }),
        locals: { env },
        cookies,
      } as unknown as APIContext;
    };
    const fields = {
      manifest: JSON.stringify(manifest),
      source_bytes: String(source.bytes),
      source_sha256: source.sha256,
    };
    expect((await POST(context('POST', fields))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();

    jar.set(
      SESSION_COOKIE,
      await createSessionCookieValue(
        { sub: 'owner', name: 'Owner', email: 'owner@example.test' },
        env.sessionSecret,
      ),
    );
    const reserved = await POST(context('POST', fields));
    expect(reserved.status).toBe(200);
    expect(reserved.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await reserved.json()).toEqual({ result: reservation });
    const confirmed = await PUT(context('PUT', { upload_id: reservation.id }));
    expect(confirmed.status).toBe(202);
    expect(await confirmed.json()).toEqual({ result: job });
  });
  it('polls packaging jobs through the authenticated API endpoint', async () => {
    const job = {
      id: 'job',
      extension_identifier: 'example',
      status: 'processing',
      artifact: null,
      error: null,
      created_at: 'now',
      updated_at: 'now',
    };
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        'https://api.test/extensions/v2/packaging-jobs/job',
      );
      expect(request.method).toBe('GET');
      expect(request.headers.get('Authorization')).toMatch(/^Bearer /);
      return Response.json({ result: job });
    });
    const env = makeEnv({
      extensionsApi: {
        baseUrl: 'https://api.test',
        fetch: fetcher as typeof fetch,
      },
    });

    expect(await createApiClient(env, 'owner').getPackageJob('job')).toEqual(
      job,
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('authenticates metadata and streaming preview reads without consuming the ZIP', async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.headers.get('Authorization')).toMatch(/^Bearer /);
      return request.url.endsWith('/download')
        ? new Response('zip', {
            headers: { 'Content-Type': 'application/zip' },
          })
        : Response.json({ result: { id: 'artifact' } });
    });
    const env = makeEnv({
      extensionsApi: {
        baseUrl: 'https://api.test',
        fetch: fetcher as typeof fetch,
      },
    });
    expect(
      await createApiClient(env, 'owner').getPackage('artifact'),
    ).toMatchObject({ id: 'artifact' });
    const response = await downloadPackage(env, 'artifact', 'owner');
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe('zip');
  });
});

describe('moderator package links', () => {
  it.each([
    ['javascript:alert(1)', false],
    ['data:text/html,<script>alert(1)</script>', false],
    ['https://example.test/package.zip', true],
    ['/package/ABCDEFAB-1234-4567-89AB-ABCDEFABCDEF', true],
    ['/package/aBcDeFaB-1234-4567-89aB-aBcDeFaBcDeF', true],
  ] as const)('checks whether %s is a safe diff link', (href, expected) => {
    expect(isSafeDiffHref(href)).toBe(expected);
  });

  it('links the reviewed artifact through the permission-aware download endpoint', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(
      fieldUrl('download_url', {
        download_url: 'https://api.test/package.zip',
        releases: [
          null,
          {
            tag: '1.0.0',
            download_url: 'https://api.test/package.zip',
            artifact_id: id,
          },
        ],
      }),
    ).toBe(`/package/${id}`);
    expect(packageDownloadPath('../private')).toBeNull();
    expect(
      isPackageDownloadPath(
        '//evil.test/package/11111111-1111-4111-8111-111111111111',
      ),
    ).toBe(false);
    expect(
      isPackageDownloadPath(
        '/package/11111111-1111-4111-8111-111111111111?redirect=evil',
      ),
    ).toBe(false);
  });
});

it('does not create package links for unmatched or external releases', () => {
  expect(
    fieldUrl('download_url', {
      download_url: 'https://api.test/selected.zip',
      releases: [
        {
          download_url: 'https://api.test/other.zip',
          artifact_id: '11111111-1111-4111-8111-111111111111',
        },
      ],
    }),
  ).toBeNull();
  expect(
    fieldUrl('download_url', {
      download_url: 'https://api.test/external.zip',
      releases: [{ download_url: 'https://api.test/external.zip' }],
    }),
  ).toBeNull();
});
it('propagates a failed package download', async () => {
  const env = makeEnv({
    extensionsApi: {
      baseUrl: 'https://api.test',
      fetch: async () => new Response(null, { status: 404 }),
    },
  });
  await expect(
    downloadPackage(env, '11111111-1111-4111-8111-111111111111'),
  ).rejects.toMatchObject({ status: 404 });
});
