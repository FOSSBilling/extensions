export const IMAGE_VARIANTS = {
  icon: { width: 64, height: 64 },
  avatar: { width: 128, height: 128 },
} as const;

export const MAX_IMAGE_SOURCE_URL_LENGTH = 2048;

// Only these origins are sent through the server-side transformer. Other
// valid HTTP(S) image URLs are left as direct browser requests so custom
// developer-hosted images continue to work without creating an open proxy.
const IMAGE_SOURCE_HOSTS = [
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

const UUID_PATH =
  '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const DIRECTORY_ASSET_PATH = new RegExp(
  `^/extensions/${UUID_PATH}/icons/${UUID_PATH}\\.(svg|png|avif)$`,
);

export function isDirectoryAssetUrl(source: string): boolean {
  try {
    const url = new URL(source);
    return (
      url.origin === 'https://extensions-assets.fossbilling.net' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      DIRECTORY_ASSET_PATH.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function directoryAssetAvifUrl(source?: string): string | undefined {
  return source && isDirectoryAssetUrl(source) && source.endsWith('.png')
    ? source.replace(/\.png$/, '.avif')
    : undefined;
}

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
  if (isDirectoryAssetUrl(sourceUrl)) return false;
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
  signature?: string,
): string | undefined {
  const source = sourceUrl?.trim();
  if (!source) {
    return undefined;
  }
  if (
    /^\/package\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/icon$/i.test(
      source,
    )
  )
    return source;

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

  if (
    !signature ||
    !isTransformableImageSource(source) ||
    source.length > MAX_IMAGE_SOURCE_URL_LENGTH
  ) {
    return source;
  }

  const params = new URLSearchParams({ src: source, sig: signature });
  return `/images/${variant}?${params.toString()}`;
}
