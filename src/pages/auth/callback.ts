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

export const GET: APIRoute = async ({ cookies, redirect, url }) => {
  const verifier = cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  const expectedState = cookies.get(OAUTH_STATE_COOKIE)?.value;
  const redirectTo = cookies.get(OAUTH_REDIRECT_COOKIE)?.value;
  cookies.delete(OAUTH_VERIFIER_COOKIE, { path: '/' });
  cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });
  cookies.delete(OAUTH_REDIRECT_COOKIE, { path: '/' });

  if (url.searchParams.get('error')) {
    return redirect('/?auth_error=1');
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
    return redirect('/?auth_error=1');
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
    return redirect('/?auth_error=1');
  }

  // A write failure here shouldn't block signing in — the session below
  // doesn't depend on it, only future ownership features will.
  try {
    await upsertUser(env.DB_EXTENSIONS, userInfo);
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
