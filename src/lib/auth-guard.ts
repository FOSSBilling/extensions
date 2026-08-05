import type { AstroCookies } from 'astro';
import { getSessionUser, SESSION_COOKIE, type SessionUser } from './session';
import { ApiRequestError } from './api/client';
import { getUser } from './users';
import type { ApplicationEnv } from './runtime';

export type AuthenticatedUser = SessionUser & {
  account: Awaited<ReturnType<typeof getUser>>;
};

// Structural subset shared by AstroGlobal (in .astro pages) and the
// destructured APIContext (in .ts API routes), so guards work in both.
interface AuthContext {
  cookies: AstroCookies;
  redirect: (path: string) => Response;
  url: URL;
}

// Guard for /account pages. Callers must check `instanceof Response` and
// return it immediately if so:
//
//   const guard = await requireUser(Astro, env);
//   if (guard instanceof Response) return guard;
//   const user = guard;
export async function requireUser(
  context: AuthContext,
  env: ApplicationEnv,
): Promise<AuthenticatedUser | Response> {
  const redirectToLogin = () => {
    const redirectTo = encodeURIComponent(
      context.url.pathname + context.url.search,
    );
    return context.redirect(`/auth/login?redirect=${redirectTo}`);
  };

  const user = await getSessionUser(context.cookies, env.sessionSecret);
  if (!user) return redirectToLogin();

  // A signed cookie can outlive the account it names by up to
  // SESSION_MAX_AGE — e.g. another device's session after /account/delete.
  // Distinguish a stale/inactive account from an API outage so a transient
  // failure does not log the user out or turn every account page into an
  // empty state.
  try {
    const account = await getUser(env, user.sub);
    if (!account.active) {
      context.cookies.delete(SESSION_COOKIE, { path: '/' });
      return redirectToLogin();
    }
    return { ...user, account };
  } catch (error) {
    // GET /users/me returns 404 only when the API has no account for this
    // subject. Other API 4xx responses (for example rate limiting or an
    // assertion/configuration problem) are not evidence that the local
    // session is stale, so keep the cookie and use the retryable 503 path.
    if (error instanceof ApiRequestError && error.status === 404) {
      context.cookies.delete(SESSION_COOKIE, { path: '/' });
      return redirectToLogin();
    }
    return new Response(
      'Unable to verify your account right now. Please try again later.',
      {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      },
    );
  }
}

export async function requireModerator(
  context: AuthContext,
  env: ApplicationEnv,
): Promise<AuthenticatedUser | Response> {
  const guard = await requireUser(context, env);
  if (guard instanceof Response) return guard;

  if (!guard.account.is_moderator) return context.redirect('/404');

  return guard;
}
