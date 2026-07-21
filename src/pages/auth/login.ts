import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from '@/lib/pkce';
import {
  buildAuthorizeUrl,
  OAUTH_VERIFIER_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_COOKIE_MAX_AGE,
} from '@/lib/oauth';

export const GET: APIRoute = async ({ cookies, redirect, url }) => {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();
  const secure = url.protocol === 'https:';

  cookies.set(OAUTH_VERIFIER_COOKIE, verifier, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });

  const redirectUri = `${url.origin}/auth/callback`;
  const authorizeUrl = buildAuthorizeUrl({
    clientId: env.AUTH_CLIENT_ID,
    redirectUri,
    state,
    codeChallenge: challenge,
  });

  return redirect(authorizeUrl);
};
