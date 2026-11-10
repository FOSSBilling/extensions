import { describe, expect, it } from 'vitest';
import {
  defaultLatestForVersion,
  latestRelease,
  releasesDescending,
  selectLatestRelease,
} from '@/lib/releases';
import type { Release } from '@/types';

function release(tag: string, date = '2026-01-01'): Release {
  return {
    tag,
    date,
    download_url: `https://example.test/${tag}.zip`,
    requires: { fossbilling: '>=0.7.0', php: '>=8.3' },
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

describe('selected latest release', () => {
  it('uses an explicit choice without reordering version history', () => {
    const older = { ...release('1.0.0'), is_latest: true };
    const newer = release('2.0.0');
    expect(latestRelease([newer, older])).toBe(older);
    expect(releasesDescending([older, newer]).map((item) => item.tag)).toEqual([
      '2.0.0',
      '1.0.0',
    ]);
  });
  it('defaults to stable versions when no release has been selected', () => {
    expect(latestRelease([release('3.0.0-rc.1'), release('2.0.0')])?.tag).toBe(
      '2.0.0',
    );
  });
});

it('moves the sole latest flag and defaults prereleases to unchecked', () => {
  const result = selectLatestRelease(
    [{ ...release('1.0.0'), is_latest: true }, release('2.0.0')],
    '2.0.0',
  );
  expect(result.filter((item) => item.is_latest)).toHaveLength(1);
  expect(latestRelease(result)?.tag).toBe('2.0.0');
  expect(defaultLatestForVersion('2.1.0')).toBe(true);
  expect(defaultLatestForVersion('2.1.0-beta.1')).toBe(false);
});

it('does not select unknown releases or default invalid tags to latest', () => {
  expect(() => selectLatestRelease([release('1.0.0')], '9.9.9')).toThrow(
    'Choose an existing release.',
  );
  expect(defaultLatestForVersion('1.0')).toBe(false);
  expect(defaultLatestForVersion('2.0-beta')).toBe(false);
});
