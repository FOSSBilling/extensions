import { describe, expect, it } from 'vitest';
import { licenseUrl } from '@/lib/license';

describe('license links', () => {
  it('prefers a supplied License URL over the SPDX page', () => {
    expect(
      licenseUrl({
        name: 'MIT',
        spdx_id: 'MIT',
        URL: 'https://example.test/license',
      }),
    ).toBe('https://example.test/license');
  });
  it('falls back to the SPDX page', () => {
    expect(licenseUrl({ name: 'MIT License', spdx_id: 'MIT' })).toBe(
      'https://spdx.org/licenses/MIT.html',
    );
  });
  it('leaves a custom license without a URL unlinked', () => {
    expect(licenseUrl({ name: 'Custom License' })).toBeUndefined();
  });
  it('does not infer an SPDX identifier from a license name', () => {
    expect(licenseUrl({ name: 'MIT' })).toBeUndefined();
  });
  it('rejects unsafe URLs and unknown identifiers', () => {
    expect(
      licenseUrl({
        name: 'License',
        URL: 'javascript:alert(1)',
        spdx_id: '../../unexpected',
      }),
    ).toBeUndefined();
    expect(
      licenseUrl({ name: 'MIT', URL: 'javascript:alert(1)', spdx_id: 'MIT' }),
    ).toBe('https://spdx.org/licenses/MIT.html');
    expect(licenseUrl(undefined)).toBeUndefined();
  });
});
