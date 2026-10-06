import { describe, expect, it } from 'vitest';
import { isDeveloperType, isExtensionType, isSourceType } from '@/types';
import { parseCatalogueFilters } from '@/lib/catalogue-filters';

describe('application boundary validation', () => {
  it('keeps runtime filter validation independent from generated DTO imports', () => {
    expect(isExtensionType('mod')).toBe(true);
    expect(isExtensionType('not-a-type')).toBe(false);
    expect(isSourceType('github')).toBe(true);
    expect(isSourceType('not-a-source')).toBe(false);
    expect(isDeveloperType('organization')).toBe(true);
    expect(isDeveloperType('not-a-developer')).toBe(false);
  });
});

describe('catalogue filter parsing', () => {
  it('parses every supported filter and ignores unknown params', () => {
    const params = new URLSearchParams(
      'type=mod&developer_id=dev-1&limit=24&cursor=opaque&q=ignored',
    );
    expect(parseCatalogueFilters(params)).toEqual({
      filters: {
        type: 'mod',
        developer_id: 'dev-1',
        limit: 24,
        cursor: 'opaque',
      },
      error: null,
    });
  });

  it('treats an empty type as absent and a non-numeric limit as unset', () => {
    expect(parseCatalogueFilters(new URLSearchParams('type='))).toEqual({
      filters: {},
      error: null,
    });
    expect(parseCatalogueFilters(new URLSearchParams('limit=abc'))).toEqual({
      filters: {},
      error: null,
    });
  });

  it('rejects an unrecognized extension type', () => {
    expect(
      parseCatalogueFilters(new URLSearchParams('type=not-a-type')),
    ).toEqual({
      filters: null,
      error: 'The extension type filter is invalid.',
    });
  });
});
