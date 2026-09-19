import { base64urlDecode, base64urlEncode } from './base64url';
import { importSigningKey } from './session';

// HMAC signing for short-lived signed cookies (flash messages, re-verify
// cooldown). All signed cookies share SESSION_SECRET's key material —
// importSigningKey caches the imported CryptoKey — but each cookie uses a
// distinct payload shape, so a payload from one cookie cannot be mistaken
// for another: every consumer validates its own expected fields.

export async function signPayload(
  payloadB64: string,
  secret: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importSigningKey(secret),
    new TextEncoder().encode(payloadB64),
  );
  return base64urlEncode(new Uint8Array(signature));
}

export async function verifyPayloadSignature(
  payloadB64: string,
  signatureB64: string,
  secret: string,
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      'HMAC',
      await importSigningKey(secret),
      base64urlDecode(signatureB64),
      new TextEncoder().encode(payloadB64),
    );
  } catch {
    return false;
  }
}
