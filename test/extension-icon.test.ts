import { describe, expect, it } from 'vitest';
import { extensionIconUrl } from '@/lib/extension-icon';
import {
  directoryAssetAvifUrl,
  isDirectoryAssetUrl,
  isTransformableImageSource,
} from '@/lib/image-url';
import { getSignedImageUrl } from '@/lib/signed-image-url';

describe('extension icons', () => {
  it('serves prepared published images directly from the CDN with AVIF/PNG fallback', async () => {
    const url =
      'https://extensions-assets.fossbilling.net/extensions/019a0000-0000-7000-8000-000000000001/icons/11111111-1111-4111-8111-111111111111.png';
    expect(
      extensionIconUrl({
        icon_url: url,
        releases: [
          {
            tag: '1.0.0',
            date: '2026-11-05',
            requires: { fossbilling: '^0.8' },
            download_url: 'https://example.test/zip',
            artifact_id: '11111111-1111-4111-8111-111111111111',
          },
        ],
      }),
    ).toBe(url);
    expect(isTransformableImageSource(url)).toBe(false);
    expect(await getSignedImageUrl(url, 'icon', 'test')).toBe(url);
    expect(directoryAssetAvifUrl(url)).toBe(url.replace(/\.png$/, '.avif'));
    expect(
      directoryAssetAvifUrl(url.replace(/\.png$/, '.svg')),
    ).toBeUndefined();
    expect(
      directoryAssetAvifUrl(
        url.replace('extensions-assets.fossbilling.net', 'untrusted.example'),
      ),
    ).toBeUndefined();
  });
  it('recognizes only the UUID icon layout on the asset origin', () => {
    const root = 'https://extensions-assets.fossbilling.net';
    const extensionId = '019a0000-0000-7000-8000-000000000001';
    const assetId = '11111111-1111-4111-8111-111111111111';
    for (const path of [
      `/extensions/${extensionId}/icons/${assetId}.svg`,
      `/extensions/${extensionId}/icons/${assetId}.png`,
      `/extensions/${extensionId}/icons/${assetId}.avif`,
    ]) {
      expect(isDirectoryAssetUrl(`${root}${path}`)).toBe(true);
    }
    for (const path of [
      `/local/icons/${'a'.repeat(64)}.png`,
      `/extensions/demo-01/icons/${assetId}.png`,
      `/extensions/${extensionId}/icons/${'a'.repeat(64)}.png`,
      `/extensions/${extensionId}/icons/${assetId}.webp`,
      `/extensions/${extensionId}/icons/${assetId}.png?version=1`,
    ]) {
      expect(isDirectoryAssetUrl(`${root}${path}`)).toBe(false);
    }
  });
  it('uses the permission-aware package icon endpoint for the latest release', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(
      extensionIconUrl({
        releases: [
          {
            tag: '1.0.0',
            date: '2026-11-05',
            download_url: 'https://example.test/package',
            requires: { fossbilling: '^0.8' },
            artifact_id: id,
          },
        ],
      }),
    ).toBe(`/package/${id}/icon`);
  });
  it('retains read-only image URLs for existing public records', () => {
    expect(
      extensionIconUrl({ icon_url: 'https://example.test/icon.png' }),
    ).toBe('https://example.test/icon.png');
  });
  it('does not interpret old paths or unsafe URLs as public images', () => {
    for (const icon_url of [
      'icon.svg',
      '../icon.svg',
      'javascript:alert(1)',
      'https://user:secret@example.test/icon.svg',
    ])
      expect(extensionIconUrl({ icon_url })).toBeUndefined();
    expect(extensionIconUrl({})).toBeUndefined();
  });
});
