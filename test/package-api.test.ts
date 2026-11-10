import { fieldUrl } from '@/lib/revision-diff-shared';
import {
  packageDownloadPath,
  isPackageDownloadPath,
  isSafeDiffHref,
} from '@/lib/package-download';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient, downloadPackage } from '@/lib/api/client';
import { makeEnv } from './helpers/env';
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
  it('sends the source ZIP as multipart data with a bearer assertion', async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.headers.get('Authorization')).toMatch(/^Bearer /);
      expect(request.headers.get('Content-Type')).toContain(
        'multipart/form-data; boundary=',
      );
      const form = await request.formData();
      expect(JSON.parse(String(form.get('manifest')))).toEqual(manifest);
      expect(await (form.get('source') as File).text()).toBe('zip');
      return Response.json(
        {
          result: {
            id: 'job',
            extension_identifier: 'example',
            status: 'ready',
            artifact: { id: 'artifact' },
            error: null,
            created_at: 'now',
            updated_at: 'now',
          },
        },
        { status: 202 },
      );
    });
    const env = makeEnv({
      extensionsApi: {
        baseUrl: 'https://api.test',
        fetch: fetcher as typeof fetch,
      },
    });
    expect(
      await createApiClient(env, 'owner').buildPackage(
        manifest,
        new File(['zip'], 'source.zip'),
      ),
    ).toMatchObject({ id: 'artifact' });
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
