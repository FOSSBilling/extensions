import type { APIContext, APIRoute } from 'astro';
import {
  IMAGE_VARIANTS,
  isImageVariant,
  isTransformableImageSource,
  type ImageVariant,
} from '@/lib/image-url';

const MAX_SOURCE_URL_LENGTH = 2048;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';

function imageUnavailable(): Response {
  return new Response('Image unavailable.', { status: 502 });
}

function parseImageSource(value: string | null, requestUrl: URL): URL | null {
  if (!value || value.length > MAX_SOURCE_URL_LENGTH) {
    return null;
  }

  try {
    const sourceUrl = new URL(value);
    if (
      !isTransformableImageSource(value) ||
      sourceUrl.origin === requestUrl.origin
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

  return (
    response.ok &&
    response.headers.get('content-type')?.toLowerCase().startsWith('image/') ===
      true
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

function cacheImageResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', CACHE_CONTROL);
  headers.set('vary', 'Accept');

  let body: BodyInit | null = response.body;
  if (response.body) {
    let bytesRead = 0;
    const boundedBody = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytesRead += chunk.byteLength;
          if (bytesRead > MAX_IMAGE_BYTES) {
            controller.error(new Error('Image response is too large.'));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    // Cloudflare's fetch types use ArrayBufferLike while lib.dom's Response
    // constructor currently narrows ReadableStream bodies to ArrayBuffer.
    body = boundedBody as unknown as BodyInit;
    headers.delete('content-length');
  }

  return new Response(body, {
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

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        accept: request.headers.get('accept') ?? 'image/*',
      },
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

    return cacheImageResponse(response);
  } catch {
    return Response.redirect(sourceUrl, 307);
  }
}

export const GET: APIRoute = handleImageRequest;
