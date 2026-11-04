import { describe, expect, it } from 'vitest';
import { isDeveloperType, isExtensionType, isSourceType } from '@/types';
import { parseDirectoryFilters } from '@/lib/directory-filters';

describe('application boundary validation', () => {
  it('validates extension, source, and developer type guards', () => {
    expect(isExtensionType('module')).toBe(true);
    expect(isExtensionType('not-a-type')).toBe(false);
    expect(isSourceType('github')).toBe(true);
    expect(isSourceType('not-a-source')).toBe(false);
    expect(isDeveloperType('organization')).toBe(true);
    expect(isDeveloperType('not-a-developer')).toBe(false);
  });
});

describe('directory filter parsing', () => {
  it('parses every supported filter and ignores unknown params', () => {
    const params = new URLSearchParams(
      'type=module&developer_id=dev-1&limit=24&cursor=opaque&q=ignored',
    );
    expect(parseDirectoryFilters(params)).toEqual({
      filters: {
        type: 'module',
        developer_id: 'dev-1',
        limit: 24,
        cursor: 'opaque',
      },
      error: null,
    });
  });

  it('treats an empty type as absent and a non-numeric limit as unset', () => {
    expect(parseDirectoryFilters(new URLSearchParams('type='))).toEqual({
      filters: {},
      error: null,
    });
    expect(parseDirectoryFilters(new URLSearchParams('limit=abc'))).toEqual({
      filters: {},
      error: null,
    });
  });

  it('rejects an unrecognized extension type', () => {
    expect(
      parseDirectoryFilters(new URLSearchParams('type=not-a-type')),
    ).toEqual({
      filters: null,
      error: 'The extension type filter is invalid.',
    });
  });
});
