import { env } from 'cloudflare:workers';
import {
  parseExtensionsApiTransportMode,
  type ApplicationEnv,
} from '@/lib/runtime';

// This is the only application import of the Cloudflare binding module. A
// different serverless provider needs a different adapter here, while pages
// and domain services continue to consume ApplicationEnv.
export function getApplicationEnv(): ApplicationEnv {
  const transport = parseExtensionsApiTransportMode(
    env.EXTENSIONS_API_TRANSPORT,
  );

  return {
    extensionsApi: {
      baseUrl: env.EXTENSIONS_API_BASE_URL,
      fetch:
        transport === 'binding'
          ? (input, init) => env.EXTENSIONS_API.fetch(input, init)
          : globalThis.fetch,
    },
    authClientId: env.AUTH_CLIENT_ID,
    authClientSecret: env.AUTH_CLIENT_SECRET,
    sessionSecret: env.SESSION_SECRET,
    assertionSigningSecret: env.ASSERTION_SIGNING_SECRET,
  };
}

export function getRequestTimeZone(request: Request): string | undefined {
  const requestCf = (request as Request & { cf?: unknown }).cf;
  if (
    typeof requestCf !== 'object' ||
    requestCf === null ||
    !('timezone' in requestCf)
  ) {
    return undefined;
  }

  const timeZone = requestCf.timezone;
  return typeof timeZone === 'string' ? timeZone : undefined;
}
