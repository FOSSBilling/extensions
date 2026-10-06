import type { APIRoute } from 'astro';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from '@/lib/pkce';
import {
  buildAuthorizeUrl,
  isSafeRedirectPath,
  oauthTransactionCookie,
  createOAuthTransaction,
} from '@/lib/oauth';

export const GET: APIRoute = async ({ cookies, redirect, url, locals }) => {
  const env = locals.env;
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();
  const redirectTo = url.searchParams.get('redirect');
  const transaction = await createOAuthTransaction(
    url,
    verifier,
    state,
    redirectTo && isSafeRedirectPath(redirectTo) ? redirectTo : '/',
    env.sessionSecret,
  );
  const cookie = oauthTransactionCookie(url);
  cookies.set(cookie.name, transaction, cookie.options);

  const redirectUri = `${url.origin}/auth/callback`;
  const authorizeUrl = buildAuthorizeUrl({
    clientId: env.authClientId,
    redirectUri,
    state,
    codeChallenge: challenge,
  });

  return redirect(authorizeUrl);
};
