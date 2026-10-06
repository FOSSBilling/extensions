import type { AstroCookies } from 'astro';
import { vi } from 'vitest';

// Minimal AstroCookies stand-in: values live in a jar the test can inspect,
// and get() mirrors Astro's { value } shape (undefined when absent).
export function fakeCookies() {
  const jar = new Map<string, string>();
  const set = vi.fn(
    (name: string, value: string, _options?: Record<string, unknown>) => {
      jar.set(name, value);
    },
  );
  const remove = vi.fn((name: string) => jar.delete(name));
  const get = vi.fn((name: string) => {
    const value = jar.get(name);
    return value === undefined ? undefined : { value };
  });
  return {
    jar,
    set,
    delete: remove,
    get,
    cookies: { get, set, delete: remove } as unknown as AstroCookies,
  };
}
