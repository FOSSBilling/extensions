import { describe, expect, it } from 'vitest';
import { parseExtensionsApiTransportMode } from '@/lib/runtime';

describe('Extensions API transport configuration', () => {
  it.each(['binding', 'http'] as const)('accepts %s mode', (mode) => {
    expect(parseExtensionsApiTransportMode(mode)).toBe(mode);
  });

  it.each([undefined, '', 'binding-with-fallback', 'https'])(
    'rejects invalid mode %s',
    (mode) => {
      expect(() => parseExtensionsApiTransportMode(mode)).toThrow(
        'EXTENSIONS_API_TRANSPORT must be "binding" or "http"',
      );
    },
  );
});
