// Lowercase SHA-256 of a byte buffer or UTF-8 string.
export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    typeof value === 'string' ? new TextEncoder().encode(value) : value,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
