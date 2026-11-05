import { describe, expect, it } from 'vitest';
import { parseRepositoryUrl, repositoryFromFields } from '@/lib/repository';

describe('Source URL detection', () => {
  it.each([
    [
      'https://github.com/FOSSBilling/example',
      { type: 'github', repo: 'FOSSBilling/example' },
    ],
    [
      'https://WWW.GITHUB.COM/FOSSBilling/example.git/?tab=readme#usage',
      { type: 'github', repo: 'FOSSBilling/example' },
    ],
    [
      'https://gitlab.com/group/subgroup/project.git',
      { type: 'gitlab', repo: 'group/subgroup/project' },
    ],
    [
      'https://code.example.test/team/project',
      { type: 'custom', repo: 'https://code.example.test/team/project' },
    ],
    [
      'http://code.example.test/project',
      { type: 'custom', repo: 'http://code.example.test/project' },
    ],
    [
      'https://github.com.evil.test/team/project',
      { type: 'custom', repo: 'https://github.com.evil.test/team/project' },
    ],
    [
      'https://github.com:8443/team/project',
      { type: 'custom', repo: 'https://github.com:8443/team/project' },
    ],
  ])('detects and normalizes %s', (input, expected) => {
    expect(parseRepositoryUrl(input)).toEqual(expected);
  });
  it.each([
    '',
    'owner/project',
    'git@github.com:owner/project.git',
    'javascript:alert(1)',
    'ftp://example.test/project',
    'https://user:secret@github.com/owner/project',
  ])('rejects an invalid or ambiguous source: %s', (input) => {
    expect(parseRepositoryUrl(input)).toBeNull();
  });
  it.each([
    'https://github.com/owner',
    'https://github.com/owner/project/tree/main',
    'https://gitlab.com/group/project/-/tree/main',
    'https://github.com/owner/%2fproject',
    'https://github.com/owner/.git',
  ])('preserves non-repository host paths as custom sources: %s', (url) => {
    expect(parseRepositoryUrl(url)).toEqual({ type: 'custom', repo: url });
  });
  it('enforces the stored repository limit after host detection', () => {
    const prefix = 'https://code.example.test/';
    expect(
      parseRepositoryUrl(prefix + 'a'.repeat(500 - prefix.length))?.repo,
    ).toHaveLength(500);
    expect(
      parseRepositoryUrl(prefix + 'a'.repeat(501 - prefix.length)),
    ).toBeNull();
    const repo = 'owner/' + 'a'.repeat(494);
    expect(parseRepositoryUrl('https://github.com/' + repo)).toEqual({
      type: 'github',
      repo,
    });
    expect(parseRepositoryUrl('https://github.com/' + repo + 'a')).toBeNull();
  });
  it('reads older draft fields while detecting the host from a new URL when supplied', () => {
    expect(
      repositoryFromFields({
        source_type: 'github',
        source_repo: 'owner/project',
      }),
    ).toEqual({ type: 'github', repo: 'owner/project' });
    expect(
      repositoryFromFields({
        source_type: 'github',
        source_repo: 'owner/project',
        source_url: 'https://gitlab.com/group/project',
      }),
    ).toEqual({ type: 'gitlab', repo: 'group/project' });
    expect(
      repositoryFromFields({
        source_type: 'github',
        source_repo: 'owner/project',
        source_url: '',
      }),
    ).toBeNull();
  });
});
