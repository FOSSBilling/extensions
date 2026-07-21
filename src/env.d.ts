export {};

// Extends the `Cloudflare.Env` interface generated in worker-configuration.d.ts
// with secrets that aren't Wrangler bindings (set via `wrangler secret put`,
// or `.dev.vars` locally) so `cloudflare:workers`' `env` stays fully typed.
declare global {
  namespace Cloudflare {
    interface Env {
      AUTH_CLIENT_ID: string;
      AUTH_CLIENT_SECRET: string;
      SESSION_SECRET: string;
    }
  }
}
