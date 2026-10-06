import { base64urlDecode, base64urlEncode } from './base64url';
import { signPayload, verifyPayloadSignature } from './signed-value';

// Client for FOSSBilling's central auth service (auth.fossbilling.net).
// Identity only — see that repo's README for the identity/authorization boundary.
// Roles, permissions, and extension ownership are modeled in the API's domain
// projection (see users.ts), never requested from or trusted to the auth service.

export const ISSUER = 'https://auth.fossbilling.net';
const AUTHORIZE_ENDPOINT = `${ISSUER}/oauth2/authorize`;
const TOKEN_ENDPOINT = `${ISSUER}/oauth2/token`;
const USERINFO_ENDPOINT = `${ISSUER}/oauth2/userinfo`;

// GitHub re-link flow: auth's /account page re-fetches the caller's org
// memberships, then our own OIDC login re-issues the ID token so the fresh
// github_login/github_orgs claims sync locally. Redirect targets the page
// that needs the refreshed snapshot.
export function buildGithubReconnectUrl(
  origin: string,
  redirect: string,
): string {
  return `${ISSUER}/account?callbackURL=${encodeURIComponent(
    `${origin}/auth/login?redirect=${encodeURIComponent(redirect)}`,
  )}`;
}

const SCOPE = 'openid profile email github';

export const OAUTH_COOKIE_MAX_AGE = 60 * 10; // 10 minutes

// The host prefix prevents sibling-domain injection, including transplantation
// of a genuine signed transaction. Only HTTP loopback development uses an
// unprefixed cookie; callbacks never fall back to legacy transaction cookies.
export function oauthTransactionCookie(url: URL) {
  const localHttp =
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return {
    name: localHttp ? 'fb_oauth_transaction' : '__Host-fb_oauth_transaction',
    options: {
      httpOnly: true,
      secure: !localHttp,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: OAUTH_COOKIE_MAX_AGE,
    },
  };
}

type OAuthTransaction = {
  kind: 'oauth-transaction';
  origin: string;
  verifier: string;
  state: string;
  redirect: string;
  exp: number;
};

export async function createOAuthTransaction(
  url: URL,
  verifier: string,
  state: string,
  redirect: string,
  secret: string,
): Promise<string> {
  const payload: OAuthTransaction = {
    kind: 'oauth-transaction',
    origin: url.origin,
    verifier,
    state,
    redirect,
    exp: Math.floor(Date.now() / 1000) + OAUTH_COOKIE_MAX_AGE,
  };
  const encoded = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${encoded}.${await signPayload(encoded, secret)}`;
}

export async function readOAuthTransaction(
  value: string | undefined,
  url: URL,
  secret: string,
): Promise<OAuthTransaction | null> {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!(await verifyPayloadSignature(parts[0], parts[1], secret))) return null;
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(parts[0])),
    );
    if (
      !payload ||
      payload.kind !== 'oauth-transaction' ||
      payload.origin !== url.origin ||
      typeof payload.verifier !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(payload.verifier) ||
      typeof payload.state !== 'string' ||
      !/^[A-Za-z0-9_-]{22}$/.test(payload.state) ||
      typeof payload.redirect !== 'string' ||
      !isSafeRedirectPath(payload.redirect) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}

// Only a same-origin relative path is a valid post-login redirect target —
// rejects absolute/protocol-relative URLs (open-redirect) and backslashes
// (browsers treat `\` as `/` in some contexts, defeating the leading-slash
// check). Also rejects tab/CR/LF: URL parsers strip these per the WHATWG URL
// spec, so e.g. "/\t/evil.com" passes a naive same-origin check here but is
// parsed as "//evil.com" — protocol-relative — by the time a browser follows
// the resulting redirect.
export function isSafeRedirectPath(value: string): boolean {
  return (
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !/[\t\r\n]/.test(value)
  );
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('code_challenge', opts.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', opts.state);
  return url.toString();
}

type TokenResponse = {
  access_token: string;
};

export async function exchangeCodeForToken(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code_verifier: opts.codeVerifier,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed with status ${response.status}`);
  }

  return response.json();
}

export type UserInfo = {
  sub: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  // Linked GitHub identity, present once a user has signed in via GitHub
  // after the auth service started requesting the read:org scope — see
  // upsertUser in users.ts. The github OIDC scope is required for these
  // linked-identity claims. github_orgs is the caller's active org logins,
  // used to verify developer profile claims (api repo's claim()). The expiry
  // is an absolute RFC3339 timestamp from the central auth service; consumers
  // must treat a missing, malformed, or past value as no organization evidence.
  'https://fossbilling.org/claims/github_login'?: string;
  'https://fossbilling.org/claims/github_orgs'?: string[];
  'https://fossbilling.org/claims/github_orgs_expires_at'?: string;
};

export async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Userinfo request failed with status ${response.status}`);
  }

  return response.json();
}
