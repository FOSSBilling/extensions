import type { FlashMessage } from '@/lib/flash';

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
      ASSERTION_SIGNING_SECRET: string;
      EXTENSIONS_API_BASE_URL: string;
    }
  }

  namespace App {
    interface SessionData {
      flash: FlashMessage;
    }
    interface Locals {
      // Read and cleared once per request by src/middleware.ts, before any
      // rendering starts — see the comment there for why that timing matters.
      flash: FlashMessage | undefined;
    }
  }
}
