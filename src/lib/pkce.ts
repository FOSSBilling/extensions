import { base64urlEncode } from './base64url';

export function generateCodeVerifier(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64urlEncode(new Uint8Array(digest));
}

export function generateState(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
}
