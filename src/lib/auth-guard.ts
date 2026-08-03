import type { AstroCookies } from 'astro';
import { getSessionUser, SESSION_COOKIE, type SessionUser } from './session';
import { isModerator, userExists } from './users';
import type { ApplicationEnv } from './runtime';

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
): Promise<SessionUser | Response> {
  const redirectToLogin = () => {
    const redirectTo = encodeURIComponent(
      context.url.pathname + context.url.search,
    );
    return context.redirect(`/auth/login?redirect=${redirectTo}`);
  };

  const user = await getSessionUser(context.cookies, env.sessionSecret);
  if (!user) return redirectToLogin();

  // A signed cookie can outlive the account it names by up to
  // SESSION_MAX_AGE — e.g. another device's session after /account/delete,
  // or a failed post-login upsert — so verify the row still exists rather
  // than trusting the cookie alone.
  if (!(await userExists(env.db, user.sub))) {
    context.cookies.delete(SESSION_COOKIE, { path: '/' });
    return redirectToLogin();
  }

  return user;
}

export async function requireModerator(
  context: AuthContext,
  env: ApplicationEnv,
): Promise<SessionUser | Response> {
  const guard = await requireUser(context, env);
  if (guard instanceof Response) return guard;

  const moderator = await isModerator(env.db, guard.sub);
  if (!moderator) return context.redirect('/404');

  return guard;
}
