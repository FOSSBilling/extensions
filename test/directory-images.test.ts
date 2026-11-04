import { describe, expect, it, vi } from 'vitest';
import { GET } from '@/pages/api/extensions';
import { listExtensions } from '@/lib/api/client';
import { verifyImageSignature } from '@/lib/signed-image-url';
import type {
  ExtensionListItem,
  ExtensionListResponse,
} from '@/lib/api/client';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  listExtensions: vi.fn(),
}));

// Shape guard for the JSON directory response: every card carries only the
// fields the response contract defines, plus the signed icon URL.
type DirectoryCardItem = Pick<
  ExtensionListItem,
  'id' | 'name' | 'description' | 'version' | 'icon_url'
> & { optimized_icon_url?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDirectoryJsonItem(value: unknown): value is DirectoryCardItem {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.version === 'string' &&
    (value.icon_url === undefined || typeof value.icon_url === 'string') &&
    (value.optimized_icon_url === undefined ||
      typeof value.optimized_icon_url === 'string')
  );
}

function isDirectoryJsonPage(value: unknown): value is {
  result: DirectoryCardItem[];
  pagination: ExtensionListResponse['pagination'];
} {
  if (!isRecord(value) || !isRecord(value.pagination)) {
    return false;
  }

  return (
    Array.isArray(value.result) &&
    value.result.every(isDirectoryJsonItem) &&
    ((typeof value.pagination.next_cursor === 'string' &&
      value.pagination.next_cursor.length > 0) ||
      value.pagination.next_cursor === null) &&
    typeof value.pagination.has_more === 'boolean'
  );
}

describe('directory image issuance', () => {
  it('issues only returned directory images and retains pagination/raw fields', async () => {
    const item = {
      id: 'ext',
      name: 'Extension',
      description: 'Description',
      version: '1.0',
      icon_url: 'https://github.com/directory/logo.png',
    };
    const pagination = { next_cursor: 'opaque', has_more: true };
    vi.mocked(listExtensions).mockResolvedValue({
      result: [item],
      pagination,
    } as Awaited<ReturnType<typeof listExtensions>>);
    const response = await GET({
      url: new URL(
        'https://extensions.example/api/extensions?src=https://github.com/attacker/logo.png',
      ),
      locals: { env: { sessionSecret: 'directory-test-secret' } },
    } as Parameters<typeof GET>[0]);
    const body = await response.json();
    if (!isDirectoryJsonPage(body))
      throw new Error('Invalid directory response');
    expect(response.status).toBe(200);
    expect(body.pagination).toEqual(pagination);
    expect(body.result[0]).toMatchObject(item);
    const image = new URL(
      body.result[0].optimized_icon_url!,
      'https://extensions.example',
    );
    expect(image.searchParams.get('src')).toBe(item.icon_url);
    expect(
      await verifyImageSignature(
        new URL(item.icon_url),
        'icon',
        image.searchParams.get('sig'),
        'directory-test-secret',
      ),
    ).toBe(true);
    expect(
      await verifyImageSignature(
        new URL('https://github.com/attacker/logo.png'),
        'icon',
        image.searchParams.get('sig'),
        'directory-test-secret',
      ),
    ).toBe(false);
  });
});
