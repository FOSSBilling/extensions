import type { ApplicationEnv } from '@/lib/runtime';

// Baseline env shared by the API-backed tests. Values are arbitrary; tests
// override fields via the argument when a specific secret or transport
// matters (e.g. the revalidate token tests).
export function makeEnv(
  overrides: Partial<ApplicationEnv> = {},
): ApplicationEnv {
  return {
    extensionsApi: {
      baseUrl: 'https://api.example.test',
      fetch: (...args) => globalThis.fetch(...args),
    },
    authClientId: 'client-id',
    authClientSecret: 'client-secret',
    sessionSecret: 'session-secret',
    assertionSigningSecret: 'assertion-secret',
    revalidateSecret: 'revalidate-secret',
    ...overrides,
  };
}
