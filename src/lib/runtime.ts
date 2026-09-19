// Application-facing runtime dependencies. Provider adapters translate their
// bindings into this small interface before requests reach application code.

export interface ExtensionsApiTransport {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
}

export type ExtensionsApiTransportMode = 'binding' | 'http';

export function parseExtensionsApiTransportMode(
  mode: string | undefined,
): ExtensionsApiTransportMode {
  if (mode === 'binding' || mode === 'http') {
    return mode;
  }

  throw new Error(
    `EXTENSIONS_API_TRANSPORT must be "binding" or "http", got "${mode}"`,
  );
}

export interface ApplicationEnv {
  extensionsApi: ExtensionsApiTransport;
  authClientId: string;
  authClientSecret: string;
  sessionSecret: string;
  assertionSigningSecret: string;
  // Shared secret for POST /api/revalidate, called by the api worker (and
  // other writers) to purge CDN-cached catalogue pages after mutations that
  // bypass this dashboard.
  revalidateSecret: string;
}
