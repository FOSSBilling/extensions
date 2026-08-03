import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOptimizedImageUrl } from '@/lib/image-url';
import { handleImageRequest } from '@/pages/images/[variant]';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function requestContext(
  variant: string,
  url: string,
  accept = 'image/avif,image/webp,image/*,*/*;q=0.8',
): Parameters<typeof handleImageRequest>[0] {
  return {
    params: { variant },
    request: new Request(url, { headers: { accept } }),
  };
}

describe('image URLs', () => {
  it('creates a stable variant URL and preserves the source as a query value', () => {
    expect(
      getOptimizedImageUrl(
        'https://raw.githubusercontent.com/fossbilling/extensions/logo.png?revision=1',
        'icon',
      ),
    ).toBe(
      '/images/icon?src=https%3A%2F%2Fraw.githubusercontent.com%2Ffossbilling%2Fextensions%2Flogo.png%3Frevision%3D1',
    );
    expect(
      getOptimizedImageUrl('https://cdn.example.test/logo.png', 'icon'),
    ).toBe('https://cdn.example.test/logo.png');
    expect(getOptimizedImageUrl('javascript:alert(1)', 'icon')).toBeUndefined();
    expect(
      getOptimizedImageUrl('https://user:secret@github.com/logo.png', 'icon'),
    ).toBeUndefined();
    expect(getOptimizedImageUrl('  ', 'avatar')).toBeUndefined();
  });
});

describe('image transformation route', () => {
  it('redirects allowlisted sources during local development', async () => {
    vi.stubEnv('MODE', 'development');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleImageRequest(
      requestContext(
        'icon',
        'https://extensions.example.test/images/icon?src=https%3A%2F%2Fraw.githubusercontent.com%2Ffossbilling%2Flogo.png',
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://raw.githubusercontent.com/fossbilling/logo.png',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests the bounded icon transform and negotiates AVIF', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('transformed image', {
        headers: { 'content-type': 'image/avif' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleImageRequest(
      requestContext(
        'icon',
        'https://extensions.example.test/images/icon?src=https%3A%2F%2Fraw.githubusercontent.com%2Ffossbilling%2Flogo.png',
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=3600, s-maxage=86400',
    );
    expect(response.headers.get('vary')).toBe('Accept');

    const options = fetchMock.mock.calls[0]?.[1] as {
      cf?: { image?: Record<string, unknown> };
    };
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://raw.githubusercontent.com/fossbilling/logo.png',
    );
    expect(options.cf?.image).toEqual({
      width: 64,
      height: 64,
      fit: 'scale-down',
      quality: 80,
      anim: false,
      format: 'avif',
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
    });
  });

  it('rejects unapproved sources before making a fetch request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleImageRequest(
      requestContext(
        'avatar',
        'https://extensions.example.test/images/avatar?src=https%3A%2F%2F127.0.0.1%2Favatar.png',
      ),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirects to the original when transformation is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('not an image', {
        headers: { 'content-type': 'text/html' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleImageRequest(
      requestContext(
        'avatar',
        'https://extensions.example.test/images/avatar?src=https%3A%2F%2Fraw.githubusercontent.com%2Ffossbilling%2Favatar.png',
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://raw.githubusercontent.com/fossbilling/avatar.png',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('redirects to the original when the transformer request throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('transform failed'));
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleImageRequest(
      requestContext(
        'icon',
        'https://extensions.example.test/images/icon?src=https%3A%2F%2Fraw.githubusercontent.com%2Ffossbilling%2Flogo.png',
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://raw.githubusercontent.com/fossbilling/logo.png',
    );
  });

  it('prefers an accepted format with a non-zero quality value', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('transformed image', {
        headers: { 'content-type': 'image/webp' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await handleImageRequest(
      requestContext(
        'icon',
        'https://extensions.example.test/images/icon?src=https%3A%2F%2Fraw.githubusercontent.com%2Ffossbilling%2Flogo.png',
        'image/avif;q=0,image/webp;q=0.8,image/*;q=0.5',
      ),
    );

    const options = fetchMock.mock.calls[0]?.[1] as {
      cf?: { image?: Record<string, unknown> };
    };
    expect(options.cf?.image).toMatchObject({ format: 'webp' });
  });

  it('rejects transformed responses above the bounded size', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('large image', {
        headers: {
          'content-type': 'image/png',
          'content-length': String(2 * 1024 * 1024 + 1),
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleImageRequest(
      requestContext(
        'icon',
        'https://extensions.example.test/images/icon?src=https%3A%2F%2Fraw.githubusercontent.com%2Ffossbilling%2Flarge.png',
      ),
    );

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not expose arbitrary variants', async () => {
    const response = await handleImageRequest(
      requestContext(
        'original',
        'https://extensions.example.test/images/original?src=https%3A%2F%2Fcdn.example.test%2Fimage.png',
      ),
    );

    expect(response.status).toBe(404);
  });
});
