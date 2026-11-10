import { describe, expect, it } from 'vitest';
import { directoryAssetAvifUrl } from '@/lib/image-url';
import { extensionIconUrl } from '@/lib/extension-icon';
import { getSignedImageUrl } from '@/lib/signed-image-url';

const extensionId = '019a0000-0000-7000-8000-000000000001';
const assetId = '11111111-1111-4111-8111-111111111111';
const iconBase = `https://extensions-assets.fossbilling.net/extensions/${extensionId}/icons/${assetId}`;

describe('prepared directory assets', () => {
  it.each(['svg', 'avif', 'png'])(
    'uses a prepared %s icon directly through the image pipeline',
    async (format) => {
      const url = `${iconBase}.${format}`;
      const icon = extensionIconUrl({
        icon_url: url,
      });
      expect(await getSignedImageUrl(icon, 'icon', 'test-secret')).toBe(url);
    },
  );

  it('offers the prepared AVIF sibling only for a canonical CDN PNG', () => {
    expect(directoryAssetAvifUrl(`${iconBase}.png`)).toBe(`${iconBase}.avif`);
    for (const url of [
      `${iconBase}.svg`,
      `${iconBase}.avif`,
      `${iconBase}.png?size=64`,
      `${iconBase}.png`.replace(extensionId, 'branding'),
      'https://example.test/icon.png',
      undefined,
    ]) {
      expect(directoryAssetAvifUrl(url)).toBeUndefined();
    }
  });
});
