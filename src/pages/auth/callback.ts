import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  exchangeCodeForToken,
  fetchUserInfo,
  isSafeRedirectPath,
  OAUTH_VERIFIER_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_REDIRECT_COOKIE,
} from '@/lib/oauth';
import {
  createSessionCookieValue,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from '@/lib/session';
import { upsertUser } from '@/lib/users';
import { getDeveloperByOwner } from '@/lib/database';
import { createApiClient } from '@/lib/api/client';
import { setFlash } from '@/lib/flash';

const AUTH_ERROR_FLASH = {
  category: 'error',
  title: 'Sign-in failed',
  description: 'Please try again.',
} as const;

export const GET: APIRoute = async ({ cookies, redirect, url, session }) => {
  const verifier = cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  const expectedState = cookies.get(OAUTH_STATE_COOKIE)?.value;
  const redirectTo = cookies.get(OAUTH_REDIRECT_COOKIE)?.value;
  cookies.delete(OAUTH_VERIFIER_COOKIE, { path: '/' });
  cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });
  cookies.delete(OAUTH_REDIRECT_COOKIE, { path: '/' });

  if (url.searchParams.get('error')) {
    setFlash(session, AUTH_ERROR_FLASH);
    return redirect('/');
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (
    !code ||
    !state ||
    !verifier ||
    !expectedState ||
    state !== expectedState
  ) {
    setFlash(session, AUTH_ERROR_FLASH);
    return redirect('/');
  }

  const redirectUri = `${url.origin}/auth/callback`;

  let userInfo;
  try {
    const token = await exchangeCodeForToken({
      code,
      redirectUri,
      codeVerifier: verifier,
      clientId: env.AUTH_CLIENT_ID,
      clientSecret: env.AUTH_CLIENT_SECRET,
    });
    userInfo = await fetchUserInfo(token.access_token);
  } catch {
    setFlash(session, AUTH_ERROR_FLASH);
    return redirect('/');
  }

  // A write failure here shouldn't block signing in — the session below
  // doesn't depend on it, only future ownership features will.
  try {
    await upsertUser(env.DB_EXTENSIONS, userInfo);
  } catch {}

  // Opportunistic re-verification: if this account owns a developer
  // profile, every login is a chance to notice their linked GitHub
  // identity (just refreshed above) no longer matches — or now does,
  // if it didn't before. Best-effort, same as upsertUser above; a
  // failure here must never block signing in. Skipped when already
  // checked recently so a user logging in repeatedly doesn't add an
  // extra API round-trip to every one of those logins.
  const RECENT_VERIFICATION_MS = 60 * 60 * 1000;
  try {
    const developer = await getDeveloperByOwner(
      env.DB_EXTENSIONS,
      userInfo.sub,
    );
    const lastVerifiedAt = developer?.github_verified_at
      ? new Date(developer.github_verified_at).getTime()
      : 0;
    if (developer && Date.now() - lastVerifiedAt > RECENT_VERIFICATION_MS) {
      await createApiClient(env, userInfo.sub).reverifyDeveloper();
    }
  } catch {}

  const secure = url.protocol === 'https:';
  const sessionValue = await createSessionCookieValue(
    {
      sub: userInfo.sub,
      name: userInfo.name ?? '',
      email: userInfo.email ?? '',
      picture: userInfo.picture,
    },
    env.SESSION_SECRET,
  );

  cookies.set(SESSION_COOKIE, sessionValue, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });

  return redirect(
    redirectTo && isSafeRedirectPath(redirectTo) ? redirectTo : '/',
  );
};
