import type { APIRoute } from 'astro';

// Catalogue mutations that bypass this dashboard (the api worker, other
// tooling) cannot trigger the in-request purgeCatalogue() hooks, so they call
// this endpoint to purge the route-cached catalogue pages instead. Until it
// is wired up, api-side changes surface within the route rule's
// maxAge+SWR window rather than instantly.

const PURGEABLE_TAGS = new Set(['catalogue', 'developers']);

// Compares digests instead of raw strings so token length never leaks
// through timing.
async function secretsMatch(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let mismatch = 0;
  for (let i = 0; i < bytesA.length; i++) {
    mismatch |= bytesA[i]! ^ bytesB[i]!;
  }
  return mismatch === 0;
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

export const POST: APIRoute = async ({ request, locals, cache }) => {
  const env = locals.env;
  const token = bearerToken(request);
  let authorized = false;
  try {
    authorized = Boolean(
      token &&
      env.revalidateSecret &&
      (await secretsMatch(token, env.revalidateSecret)),
    );
  } catch (error) {
    console.error('[revalidate] token comparison failed:', error);
  }
  if (!authorized) {
    return Response.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'A valid revalidate token is required.',
        },
      },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        error: { code: 'INVALID_BODY', message: 'A JSON body is required.' },
      },
      { status: 400 },
    );
  }

  const tags = (body as { tags?: unknown } | null)?.tags;
  if (
    !Array.isArray(tags) ||
    tags.length === 0 ||
    tags.some((tag) => typeof tag !== 'string' || !PURGEABLE_TAGS.has(tag))
  ) {
    return Response.json(
      {
        error: {
          code: 'INVALID_TAGS',
          message: `tags must be a non-empty array drawn from: ${[
            ...PURGEABLE_TAGS,
          ].join(', ')}.`,
        },
      },
      { status: 400 },
    );
  }

  if (!cache.enabled) {
    // Dev mode: no provider-backed cache exists, so report success without
    // purging (matches the no-op behavior of the cache API in dev).
    return Response.json({ purged: tags, cache: 'disabled' });
  }

  try {
    await cache.invalidate({ tags: tags as string[] });
  } catch (error) {
    // Local workerd does not emulate Workers Cache purges; only real purge
    // failures should surface as errors. Production callers retry on 502.
    if (
      error instanceof TypeError &&
      /purge is not a function/.test(error.message)
    ) {
      console.warn(
        '[revalidate] purge unavailable in local dev; treating as success',
      );
      return Response.json({
        purged: tags,
        cache: 'purge-unavailable-locally',
      });
    }
    console.error('[revalidate] CDN purge failed:', error);
    return Response.json(
      {
        error: {
          code: 'PURGE_FAILED',
          message: 'The CDN purge request failed. Retry with backoff.',
        },
      },
      { status: 502 },
    );
  }

  return Response.json({ purged: tags });
};
