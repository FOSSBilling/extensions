import { describe, expect, it } from 'vitest';
import { isCatalogueCardPage } from '@/scripts/extension-catalogue';
import { isDeveloperType, isExtensionType, isSourceType } from '@/types';

describe('application boundary validation', () => {
  it('validates only the fields used by catalogue cards', () => {
    expect(
      isCatalogueCardPage({
        result: [
          {
            id: 'card-only',
            name: 'Card only',
            description: 'Card fields are sufficient.',
            version: '1.0.0',
          },
        ],
        pagination: { next_cursor: null, has_more: false },
      }),
    ).toBe(true);

    expect(
      isCatalogueCardPage({
        result: [
          {
            id: 'invalid-card',
            name: 123,
            description: 'Invalid name.',
            version: '1.0.0',
          },
        ],
        pagination: { next_cursor: null, has_more: false },
      }),
    ).toBe(false);

    expect(
      isCatalogueCardPage({
        result: [],
        pagination: { next_cursor: '', has_more: true },
      }),
    ).toBe(false);
  });

  it('keeps runtime filter validation independent from generated DTO imports', () => {
    expect(isExtensionType('mod')).toBe(true);
    expect(isExtensionType('not-a-type')).toBe(false);
    expect(isSourceType('github')).toBe(true);
    expect(isSourceType('not-a-source')).toBe(false);
    expect(isDeveloperType('organization')).toBe(true);
    expect(isDeveloperType('not-a-developer')).toBe(false);
  });
});
