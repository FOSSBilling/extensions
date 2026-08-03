import type { APIContext, APIRoute } from 'astro';
import {
  IMAGE_VARIANTS,
  MAX_IMAGE_SOURCE_URL_LENGTH,
  isImageVariant,
  isTransformableImageSource,
  type ImageVariant,
} from '@/lib/image-url';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const INITIAL_IMAGE_BUFFER_BYTES = 64 * 1024;
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';
const IMAGE_ROUTE_PATHS = new Set(['/images/icon', '/images/avatar']);
const CONDITIONAL_REQUEST_HEADERS = [
  'if-none-match',
  'if-modified-since',
] as const;

function imageUnavailable(): Response {
  return new Response('Image unavailable.', { status: 502 });
}

function parseImageSource(value: string | null, requestUrl: URL): URL | null {
  if (!value || value.length > MAX_IMAGE_SOURCE_URL_LENGTH) {
    return null;
  }

  try {
    const sourceUrl = new URL(value);
    if (
      !isTransformableImageSource(value) ||
      (sourceUrl.origin === requestUrl.origin &&
        IMAGE_ROUTE_PATHS.has(sourceUrl.pathname))
    ) {
      return null;
    }

    return sourceUrl;
  } catch {
    return null;
  }
}

function acceptedQuality(accept: string | null, mediaType: string): number {
  const entry = accept
    ?.toLowerCase()
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.split(';', 1)[0] === mediaType);

  if (!entry) {
    return 0;
  }

  const qualityParameter = entry
    .split(';')
    .slice(1)
    .map((parameter) => parameter.trim())
    .find((parameter) => parameter.startsWith('q='));
  if (!qualityParameter) {
    return 1;
  }

  const quality = Number(qualityParameter.slice(2));
  return Number.isFinite(quality) ? Math.min(1, Math.max(0, quality)) : 0;
}

function negotiateFormat(accept: string | null): 'avif' | 'webp' | undefined {
  const avifQuality = acceptedQuality(accept, 'image/avif');
  const webpQuality = acceptedQuality(accept, 'image/webp');

  if (avifQuality === 0 && webpQuality === 0) {
    return undefined;
  }

  return avifQuality >= webpQuality ? 'avif' : 'webp';
}

function isImageResponse(response: Response): boolean {
  if (response.status === 304) {
    return true;
  }

  const contentType = response.headers.get('content-type')?.toLowerCase();
  const mediaType = contentType?.split(';', 1)[0].trim();

  return (
    response.ok &&
    mediaType?.startsWith('image/') === true &&
    mediaType !== 'image/svg+xml'
  );
}

function hasAcceptableContentLength(response: Response): boolean {
  const contentLength = response.headers.get('content-length');
  if (contentLength === null) {
    return true;
  }

  if (!/^\d+$/.test(contentLength)) {
    return false;
  }

  const length = Number(contentLength);
  return (
    Number.isSafeInteger(length) && length >= 0 && length <= MAX_IMAGE_BYTES
  );
}

const IMAGE_RESPONSE_HEADERS = [
  'content-type',
  'etag',
  'last-modified',
] as const;

function imageResponseHeaders(response: Response): Headers {
  const headers = new Headers();
  for (const name of IMAGE_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  headers.set('cache-control', CACHE_CONTROL);
  headers.set('vary', 'Accept');
  headers.set('x-content-type-options', 'nosniff');
  return headers;
}

async function readBoundedBody(response: Response): Promise<Uint8Array | null> {
  if (!response.body) {
    return new Uint8Array();
  }

  const contentLength = response.headers.get('content-length');
  const initialCapacity =
    contentLength === null
      ? INITIAL_IMAGE_BUFFER_BYTES
      : Math.min(MAX_IMAGE_BYTES, Number(contentLength));
  let body = new Uint8Array(initialCapacity);
  let bytesRead = 0;

  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      bytesRead += value.byteLength;
      if (bytesRead > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }

      if (bytesRead > body.length) {
        const nextCapacity = Math.min(
          MAX_IMAGE_BYTES,
          Math.max(bytesRead, body.length * 2, 1),
        );
        const nextBody = new Uint8Array(nextCapacity);
        nextBody.set(body.subarray(0, bytesRead - value.byteLength));
        body = nextBody;
      }
      body.set(value, bytesRead - value.byteLength);
    }
  } catch {
    return null;
  }

  return body.subarray(0, bytesRead);
}

async function cacheImageResponse(response: Response): Promise<Response> {
  const headers = imageResponseHeaders(response);

  if (response.status === 304) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const body = await readBoundedBody(response);
  if (body === null) {
    return imageUnavailable();
  }

  // Cloudflare's Uint8Array uses ArrayBufferLike while lib.dom's Response
  // constructor currently narrows BodyInit's typed array to ArrayBuffer.
  return new Response(body as unknown as BodyInit, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleImageRequest({
  params,
  request,
}: Pick<APIContext, 'params' | 'request'>): Promise<Response> {
  if (!isImageVariant(params.variant)) {
    return new Response('Unknown image variant.', { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const sourceUrl = parseImageSource(
    requestUrl.searchParams.get('src'),
    requestUrl,
  );
  if (!sourceUrl) {
    return new Response('Invalid image source.', { status: 400 });
  }

  if (import.meta.env.MODE === 'development') {
    return Response.redirect(sourceUrl, 307);
  }

  const variant: ImageVariant = params.variant;
  const format = negotiateFormat(request.headers.get('accept'));
  const { width, height } = IMAGE_VARIANTS[variant];
  const upstreamHeaders = new Headers({
    accept: request.headers.get('accept') ?? 'image/*',
  });
  for (const name of CONDITIONAL_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) {
      upstreamHeaders.set(name, value);
    }
  }

  try {
    const response = await fetch(sourceUrl, {
      headers: upstreamHeaders,
      redirect: 'error',
      cf: {
        image: {
          width,
          height,
          fit: 'scale-down',
          quality: 80,
          anim: false,
          ...(format ? { format } : {}),
        },
      },
    });

    if (!isImageResponse(response)) {
      return Response.redirect(sourceUrl, 307);
    }

    if (!hasAcceptableContentLength(response)) {
      return imageUnavailable();
    }

    return await cacheImageResponse(response);
  } catch {
    return Response.redirect(sourceUrl, 307);
  }
}

export const GET: APIRoute = handleImageRequest;
