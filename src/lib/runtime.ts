// Application-facing runtime dependencies. Provider adapters translate their
// bindings into this small interface before requests reach application code.

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{
    success: boolean;
    results: T[];
  }>;
  run(): Promise<unknown>;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
}

export interface ApplicationEnv {
  db: SqlDatabase;
  extensionsApiBaseUrl: string;
  authClientId: string;
  authClientSecret: string;
  sessionSecret: string;
  assertionSigningSecret: string;
}
