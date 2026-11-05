import { expect, it } from 'vitest';
import { compatibilityLabel } from '@/lib/requirements';

it.each([
  ['>=0.7.0', '0.7.0 or Later'],
  ['>= 8.3', '8.3 or Later'],
  ['>=8.3 <9', '>=8.3 <9'],
  ['^0.8.9 || ^1.0', '^0.8.9 || ^1.0'],
  ['~8.3', '~8.3'],
  ['>=8.4-beta', '>=8.4-beta'],
])('presents %s without changing constraint semantics', (range, expected) => {
  expect(compatibilityLabel(range)).toBe(expected);
});
