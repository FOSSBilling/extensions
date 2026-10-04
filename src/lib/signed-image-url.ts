// Server-only issuance: call with images from catalogue/account data, never
// with an arbitrary request query value. The browser only receives the URL.
import {
  getOptimizedImageUrl,
  isTransformableImageSource,
  MAX_IMAGE_SOURCE_URL_LENGTH,
  type ImageVariant,
} from './image-url';
import { signPayload, verifyPayloadSignature } from './signed-value';

function imagePayload(source: string, variant: ImageVariant): string {
  // Domain separation prevents reuse of signatures from cookies/assertions.
  return JSON.stringify(['image-transform-v1', variant, new URL(source).href]);
}

export async function getSignedImageUrl(
  sourceUrl: string | null | undefined,
  variant: ImageVariant,
  secret: string,
): Promise<string | undefined> {
  const source = sourceUrl?.trim();
  if (
    !source ||
    !secret ||
    source.length > MAX_IMAGE_SOURCE_URL_LENGTH ||
    !isTransformableImageSource(source)
  ) {
    return getOptimizedImageUrl(sourceUrl, variant);
  }
  const canonicalSource = new URL(source).href;
  const signature = await signPayload(
    imagePayload(canonicalSource, variant),
    secret,
  );
  return getOptimizedImageUrl(canonicalSource, variant, signature);
}

export async function verifyImageSignature(
  source: URL,
  variant: ImageVariant,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  // SHA-256 HMAC has exactly 43 canonical base64url characters.
  return (
    !!secret &&
    !!signature &&
    /^[A-Za-z0-9_-]{43}$/.test(signature) &&
    verifyPayloadSignature(
      imagePayload(source.href, variant),
      signature,
      secret,
    )
  );
}
