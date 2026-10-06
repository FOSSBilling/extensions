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
  if (url.protocol === 'http:' && cookie.options.secure) {
    // Browsers refuse Secure cookies over insecure schemes, so the callback
    // would never see this transaction and login would fail generically.
    console.warn(
      '[auth/login] plain-HTTP non-loopback origin; the Secure transaction cookie will be refused — serve over HTTPS or use a loopback host for local development',
    );
  }
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
