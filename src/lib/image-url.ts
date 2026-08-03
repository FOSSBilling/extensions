export const IMAGE_VARIANTS = {
  icon: { width: 64, height: 64 },
  avatar: { width: 128, height: 128 },
} as const;

// Only these origins are sent through the server-side transformer. Other
// valid HTTP(S) image URLs are left as direct browser requests so custom
// developer-hosted images continue to work without creating an open proxy.
export const IMAGE_SOURCE_HOSTS = [
  'fossbilling.net',
  'fossbilling.org',
  'github.com',
  'githubusercontent.com',
  'gitlab.com',
  'gitlabusercontent.com',
  'googleusercontent.com',
  'gravatar.com',
] as const;

export type ImageVariant = keyof typeof IMAGE_VARIANTS;

export function isImageVariant(
  value: string | undefined,
): value is ImageVariant {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(IMAGE_VARIANTS, value)
  );
}

function isAllowedImageHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return IMAGE_SOURCE_HOSTS.some(
    (host) => normalized === host || normalized.endsWith(`.${host}`),
  );
}

export function isTransformableImageSource(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      isAllowedImageHost(url.hostname)
    );
  } catch {
    return false;
  }
}

export function getOptimizedImageUrl(
  sourceUrl: string | null | undefined,
  variant: ImageVariant,
): string | undefined {
  const source = sourceUrl?.trim();
  if (!source) {
    return undefined;
  }

  try {
    const url = new URL(source);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  if (!isTransformableImageSource(source)) {
    return source;
  }

  const params = new URLSearchParams({ src: source });
  return `/images/${variant}?${params.toString()}`;
}
