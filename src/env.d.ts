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
      EXTENSIONS_REVALIDATE_SECRET: string;
    }
  }

  namespace App {
    interface Locals {
      env: ApplicationEnv;
      timeZone: string | undefined;
      // Cloudflare execution context, provided by the adapter in deployed
      // builds only (absent in `astro dev`), used to background cache purges.
      cfContext?: { waitUntil: (promise: Promise<unknown>) => void };
    }
  }
}
