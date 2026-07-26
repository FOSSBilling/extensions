import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '@/lib/session';

// A cross-site page could auto-submit this form to force a visitor's
// session to be cleared. SameSite=Lax on the session cookie already stops a
// cross-site POST from carrying it, but the response's Set-Cookie deletion
// would still apply regardless — so check Origin ourselves rather than rely
// on that. Same-origin requests always send Origin on POST; only reject
// when it's present and doesn't match.
export const POST: APIRoute = async ({ cookies, redirect, request, url }) => {
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) {
    return redirect('/');
  }

  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/');
};
