import { describe, expect, it } from 'vitest';
import { extensionIconUrl } from '@/lib/extension-icon';
const extension = {
  id: 'branding',
  icon_url: 'assets/icon.svg',
  download_url:
    'https://github.com/FOSSBilling/modules/releases/download/branding-v0.8.9/branding.zip',
  source: { type: 'github', repo: 'FOSSBilling/modules' },
};
describe('package icons', () => {
  it('resolves first-party package paths against the published release tag', () => {
    expect(extensionIconUrl(extension)).toBe(
      'https://raw.githubusercontent.com/FOSSBilling/modules/branding-v0.8.9/Branding/assets/icon.svg',
    );
  });
  it('resolves single-repository package paths at the repository root', () => {
    expect(
      extensionIconUrl({
        ...extension,
        source: { type: 'github', repo: 'owner/module' },
        download_url:
          'https://github.com/owner/module/releases/download/v1.0.0/module.zip',
      }),
    ).toBe(
      'https://raw.githubusercontent.com/owner/module/v1.0.0/assets/icon.svg',
    );
  });
  it('retains legacy absolute HTTP(S) icons', () => {
    expect(
      extensionIconUrl({
        ...extension,
        icon_url: 'https://example.test/icon.svg',
      }),
    ).toBe('https://example.test/icon.svg');
  });
  it.each([
    '../icon.svg',
    'x\n../icon.svg',
    'a\n/../../icon.svg',
    'x\r../icon.svg',
    'x\u2028../icon.svg',
    'x\u2029../icon.svg',
    'assets/\u0000icon.svg',
    '/icon.svg',
    'javascript:alert(1)',
    'a\\icon.svg',
    'https://user:password@example.com/icon.svg',
  ])('rejects unsafe icon %s', (icon_url) => {
    expect(extensionIconUrl({ ...extension, icon_url })).toBeUndefined();
  });
  it('rejects mismatched asset sources, unsupported hosts, and refs containing paths', () => {
    for (const download_url of [
      'https://github.com/other/repo/releases/download/v1.0.0/a.zip',
      'https://example.com/icon.zip',
      'https://github.com/FOSSBilling/modules/releases/download/a%2Fb/a.zip',
    ])
      expect(extensionIconUrl({ ...extension, download_url })).toBeUndefined();
    expect(
      extensionIconUrl({
        ...extension,
        source: { type: 'custom', repo: 'https://example.com' },
      }),
    ).toBeUndefined();
  });
});
