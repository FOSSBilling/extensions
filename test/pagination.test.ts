import { describe, expect, it } from 'vitest';
import {
  cursorPageUrl,
  filterPageUrl,
  prevCursorPageUrl,
} from '@/lib/pagination';

describe('server-rendered cursor links', () => {
  it('preserves active filters and passes the opaque cursor unchanged', () => {
    expect(
      cursorPageUrl(
        new URL(
          'https://example.test/account/moderate?status=approved&view=queue',
        ),
        'cursor',
        'cursors',
        'cursor/with?opaque=characters',
      ),
    ).toBe(
      '/account/moderate?status=approved&view=queue&cursor=cursor%2Fwith%3Fopaque%3Dcharacters',
    );
  });

  it('pushes the current cursor onto the back-stack when moving forward', () => {
    expect(
      cursorPageUrl(
        new URL('https://example.test/account/moderate?cursor=page-2'),
        'cursor',
        'cursors',
        'page-3',
      ),
    ).toBe('/account/moderate?cursor=page-3&cursors=page-2');

    expect(
      cursorPageUrl(
        new URL(
          'https://example.test/account/moderate?cursor=page-2&cursors=page-1',
        ),
        'cursor',
        'cursors',
        'page-3',
      ),
    ).toBe('/account/moderate?cursor=page-3&cursors=page-1%2Cpage-2');
  });

  it('caps the back-stack depth, dropping the oldest cursor first', () => {
    const fullStack = Array.from({ length: 20 }, (_, i) => `page-${i}`).join(
      ',',
    );

    expect(
      cursorPageUrl(
        new URL(
          `https://example.test/account/moderate?cursor=page-20&cursors=${fullStack}`,
        ),
        'cursor',
        'cursors',
        'page-21',
      ),
    ).toBe(
      `/account/moderate?cursor=page-21&cursors=${encodeURIComponent(
        Array.from({ length: 20 }, (_, i) => `page-${i + 1}`).join(','),
      )}`,
    );
  });

  // Documents the accepted trade-off from capping: once an early cursor has
  // been evicted, walking Previous all the way back lands on page 1 without
  // stopping on the page whose cursor was dropped - it doesn't error or
  // strand the viewer, it just skips one page. A stack that isn't capped
  // wouldn't have this gap (see the pop-until-null case above), so this is
  // deliberately different behaviour, not a bug in prevCursorPageUrl itself.
  it('reaches page 1 without stopping on an evicted page, once the stack is capped', () => {
    // Reproduce exactly what cursorPageUrl leaves behind once the back-stack
    // is capped: page-0's cursor was dropped, so `cursors` holds page-1
    // through page-20 while viewing page-21 (see the "caps the back-stack
    // depth" test above for how this state is produced).
    const cappedStack = Array.from(
      { length: 20 },
      (_, i) => `page-${i + 1}`,
    ).join(',');
    let url = new URL(
      `https://example.test/account/moderate?cursor=page-21&cursors=${cappedStack}`,
    );

    // Walk Previous all the way back through the capped stack. Each step
    // should land on the expected preceding page - the cap doesn't corrupt
    // the still-present entries.
    for (let page = 20; page >= 1; page--) {
      const href = prevCursorPageUrl(url, 'cursor', 'cursors');
      expect(href).not.toBeNull();
      url = new URL(href as string, url);
      expect(url.searchParams.get('cursor')).toBe(`page-${page}`);
    }

    // page-0's cursor was evicted, so the final step from page-1 lands
    // directly on the first page instead of stopping on page-0 first.
    expect(prevCursorPageUrl(url, 'cursor', 'cursors')).toBe(
      '/account/moderate',
    );
  });

  it('pops the back-stack to build the previous page, or null on the first page', () => {
    expect(
      prevCursorPageUrl(
        new URL('https://example.test/account/moderate'),
        'cursor',
        'cursors',
      ),
    ).toBeNull();

    expect(
      prevCursorPageUrl(
        new URL(
          'https://example.test/account/moderate?cursor=page-3&cursors=page-1%2Cpage-2',
        ),
        'cursor',
        'cursors',
      ),
    ).toBe('/account/moderate?cursor=page-2&cursors=page-1');

    // Popping the last stacked cursor returns to the first page: no cursor
    // param at all, not an empty one.
    expect(
      prevCursorPageUrl(
        new URL('https://example.test/account/moderate?cursor=page-2'),
        'cursor',
        'cursors',
      ),
    ).toBe('/account/moderate');
  });

  it('drops the cursor and its back-stack when a filter changes', () => {
    expect(
      filterPageUrl(
        new URL(
          'https://example.test/account/moderate?extStatus=published&extCursor=page-2&extCursors=page-1',
        ),
        'extStatus',
        'delisted',
        ['extCursor', 'extCursors'],
      ),
    ).toBe('/account/moderate?extStatus=delisted');

    expect(
      filterPageUrl(
        new URL(
          'https://example.test/account/moderate?extStatus=delisted&extCursor=page-2',
        ),
        'extStatus',
        null,
        ['extCursor', 'extCursors'],
      ),
    ).toBe('/account/moderate');
  });
});
