// Client for FOSSBilling's central auth service (auth.fossbilling.net).
// Identity only — see that repo's README for the identity/authorization boundary.
// Roles, permissions, and extension ownership are modeled in this app's own
// database (see users.ts), never requested from or trusted to the auth service.

const ISSUER = 'https://auth.fossbilling.net';
const AUTHORIZE_ENDPOINT = `${ISSUER}/oauth2/authorize`;
const TOKEN_ENDPOINT = `${ISSUER}/oauth2/token`;
const USERINFO_ENDPOINT = `${ISSUER}/oauth2/userinfo`;

const SCOPE = 'openid profile email offline_access';

// Short-lived cookies that carry the PKCE verifier and CSRF state across the
// redirect to the auth service and back. Cleared as soon as the callback
// consumes them.
export const OAUTH_VERIFIER_COOKIE = 'fb_oauth_verifier';
export const OAUTH_STATE_COOKIE = 'fb_oauth_state';
export const OAUTH_COOKIE_MAX_AGE = 60 * 10; // 10 minutes

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
