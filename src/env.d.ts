import type { ApplicationEnv } from '@/lib/runtime';

export {};

// Extends the `Cloudflare.Env` interface generated in worker-configuration.d.ts
// with secrets that aren't Wrangler bindings (set via `wrangler secret put`,
// or `.dev.vars` locally) so the Cloudflare adapter stays fully typed.
declare global {
  namespace Cloudflare {
    interface Env {
      AUTH_CLIENT_ID: string;
      AUTH_CLIENT_SECRET: string;
      SESSION_SECRET: string;
      ASSERTION_SIGNING_SECRET: string;
      EXTENSIONS_API_BASE_URL: string;
    }
  }

  namespace App {
    interface SessionData {
      // Astro session (KV) now only carries the re-verify cooldown; flash
      // messages live in a signed cookie — see src/lib/flash.ts.
      reverifyCooldownUntil?: number;
    }
    interface Locals {
      env: ApplicationEnv;
      timeZone: string | undefined;
    }
  }
}
