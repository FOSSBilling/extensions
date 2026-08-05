// Application-facing runtime dependencies. Provider adapters translate their
// bindings into this small interface before requests reach application code.

export interface ApplicationEnv {
  extensionsApiBaseUrl: string;
  authClientId: string;
  authClientSecret: string;
  sessionSecret: string;
  assertionSigningSecret: string;
}
