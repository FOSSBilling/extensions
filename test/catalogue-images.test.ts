import { describe, expect, it, vi } from 'vitest';
import { GET } from '@/pages/api/extensions';
import { listExtensions } from '@/lib/api/client';
import { verifyImageSignature } from '@/lib/signed-image-url';
import { isCatalogueCardPage } from '@/scripts/extension-catalogue';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  listExtensions: vi.fn(),
}));

describe('catalogue image issuance', () => {
  it('issues only returned catalogue images and retains pagination/raw fields', async () => {
    const item = {
      id: 'ext',
      name: 'Extension',
      description: 'Description',
      version: '1.0',
      icon_url: 'https://github.com/catalogue/logo.png',
    };
    const pagination = { next_cursor: 'opaque', has_more: true };
    vi.mocked(listExtensions).mockResolvedValue({
      result: [item],
      pagination,
    } as Awaited<ReturnType<typeof listExtensions>>);
    const response = await GET({
      url: new URL(
        'https://extensions.example/api/extensions?src=https://github.com/attacker/logo.png',
      ),
      locals: { env: { sessionSecret: 'catalogue-test-secret' } },
    } as Parameters<typeof GET>[0]);
    const body = await response.json();
    if (!isCatalogueCardPage(body))
      throw new Error('Invalid catalogue response');
    expect(response.status).toBe(200);
    expect(body.pagination).toEqual(pagination);
    expect(body.result[0]).toMatchObject(item);
    expect(isCatalogueCardPage(body)).toBe(true);
    const image = new URL(
      body.result[0].optimized_icon_url!,
      'https://extensions.example',
    );
    expect(image.searchParams.get('src')).toBe(item.icon_url);
    expect(
      await verifyImageSignature(
        new URL(item.icon_url),
        'icon',
        image.searchParams.get('sig'),
        'catalogue-test-secret',
      ),
    ).toBe(true);
    expect(
      await verifyImageSignature(
        new URL('https://github.com/attacker/logo.png'),
        'icon',
        image.searchParams.get('sig'),
        'catalogue-test-secret',
      ),
    ).toBe(false);
  });
});
