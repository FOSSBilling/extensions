import { describe, expect, it } from 'vitest';
import { latestRelease, releasesDescending } from '@/lib/releases';
import type { Release } from '@/types';

function release(tag: string, date = '2026-01-01'): Release {
  return {
    tag,
    date,
    download_url: `https://example.test/${tag}.zip`,
    min_fossbilling_version: '0.7.0',
  };
}

describe('automatic latest release', () => {
  it('uses semantic version order rather than date, insertion order, or lexical order', () => {
    const releases = [
      release('1.9.0', '2026-11-01'),
      release('v1.10.0', '2026-01-01'),
      release('1.2.0', '2026-12-01'),
    ];
    expect(latestRelease(releases)?.tag).toBe('v1.10.0');
    expect(releasesDescending(releases).map((item) => item.tag)).toEqual([
      'v1.10.0',
      '1.9.0',
      '1.2.0',
    ]);
    expect(releases[0].tag).toBe('1.9.0');
  });
  it('handles prereleases using semantic version precedence', () => {
    expect(
      latestRelease([
        release('2.0.0-beta.2'),
        release('2.0.0'),
        release('2.0.0-beta.10'),
      ])?.tag,
    ).toBe('2.0.0');
    expect(
      latestRelease([release('2.0.0-beta.2'), release('2.0.0-beta.10')])?.tag,
    ).toBe('2.0.0-beta.10');
  });
  it('uses release dates when no tags are semantic versions', () => {
    expect(
      latestRelease([
        release('earlier', '2026-01-01'),
        release('later', '2026-02-01'),
        release('unknown', 'invalid'),
      ])?.tag,
    ).toBe('later');
  });
  it('prefers versioned releases when mixed with unversioned historical tags', () => {
    expect(
      latestRelease([
        release('nightly', '2026-12-01'),
        release('v1.0.0', '2026-01-01'),
      ])?.tag,
    ).toBe('v1.0.0');
  });
  it('handles empty lists and unparseable legacy dates deterministically', () => {
    expect(latestRelease([])).toBeUndefined();
    expect(
      latestRelease([release('first', 'invalid'), release('second', 'invalid')])
        ?.tag,
    ).toBe('first');
  });
});
