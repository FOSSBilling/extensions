// Lowercase hex SHA-256 over UTF-8 bytes. Used to bind request bodies to
// the identity-sync bearer assertion (see assertion.ts): the API hashes the
// exact request bytes, so callers must hash the same bytes they send.
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
