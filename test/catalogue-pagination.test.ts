import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, type ExtensionListResponse } from '@/lib/api/client';
import {
  appendPage,
  createCataloguePager,
  createCataloguePagerFromIds,
  stateFromPage,
  type CataloguePageRequest,
} from '@/lib/catalogue-pagination';
import { item, page } from './helpers/catalogue-fixtures';

describe('catalogue page accumulation', () => {
  const filters = {
    type: 'mod' as const,
    developer_id: 'developer-id',
    limit: 100,
  };

  it('appends middle pages in API order, preserves existing items, and replaces the cursor', async () => {
    const first = page(
      [item('zeta', 'Zulu'), item('alpha', 'Alpha')],
      'cursor-2',
      true,
    );
    const second = page(
      [item('beta', 'beta'), item('ALPHA', 'alpha duplicate')],
      'cursor-3',
      true,
    );
    const loadPage = vi.fn().mockResolvedValue(second);
    const pager = createCataloguePager(first, filters, loadPage);

    const state = await pager.loadNextPage();

    expect(loadPage).toHaveBeenCalledWith({
      ...filters,
      cursor: 'cursor-2',
    } satisfies CataloguePageRequest);
    expect(state.items.map((extension) => extension.id)).toEqual([
      'zeta',
      'alpha',
      'beta',
    ]);
    expect(state.nextCursor).toBe('cursor-3');
    expect(state.hasMore).toBe(true);
  });

  it('deduplicates already-rendered DOM IDs without constructing fake DTOs', async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValue(page([item('ALPHA'), item('second')], null, false));
    const pager = createCataloguePagerFromIds(
      ['alpha'],
      { next_cursor: 'cursor-2', has_more: true },
      filters,
      loadPage,
    );

    const state = await pager.loadNextPage();

    expect(state.items.map((extension) => extension.id)).toEqual(['second']);
  });

  it('does not duplicate concurrent next-page requests', async () => {
    let resolvePage: ((value: ExtensionListResponse) => void) | undefined;
    const loadPage = vi.fn(
      () =>
        new Promise<ExtensionListResponse>((resolve) => {
          resolvePage = resolve;
        }),
    );
    const pager = createCataloguePager(
      page([item('first')], 'cursor-2', true),
      filters,
      loadPage,
    );

    const firstRequest = pager.loadNextPage();
    const duplicateRequest = pager.loadNextPage();
    expect(loadPage).toHaveBeenCalledTimes(1);

    resolvePage?.(page([item('second')], null, false));
    await Promise.all([firstRequest, duplicateRequest]);

    expect(pager.getState().items.map((extension) => extension.id)).toEqual([
      'first',
      'second',
    ]);
  });

  it('appends a final page and offers no further request', async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce(page([item('last')], null, false));
    const pager = createCataloguePager(
      page([item('first')], 'cursor-final', true),
      filters,
      loadPage,
    );

    const state = await pager.loadNextPage();
    await pager.loadNextPage();

    expect(state.items.map((extension) => extension.id)).toEqual([
      'first',
      'last',
    ]);
    expect(state.hasMore).toBe(false);
    expect(state.nextCursor).toBeNull();
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it('does not offer a next page when the cursor is empty', () => {
    const pageWithEmptyCursor = page([item('only')], '', true);

    expect(stateFromPage(pageWithEmptyCursor).hasMore).toBe(false);
    expect(
      appendPage(
        stateFromPage(page([item('first')], 'cursor-2', true)),
        pageWithEmptyCursor,
      ).hasMore,
    ).toBe(false);
  });

  it('retains loaded results and does not reset or retry after an invalid cursor', async () => {
    const invalidCursor = new ApiRequestError(
      422,
      'INVALID_CURSOR',
      'Cursor is invalid.',
    );
    const loadPage = vi.fn().mockRejectedValue(invalidCursor);
    const pager = createCataloguePager(
      page([item('first')], 'invalid-cursor', true),
      filters,
      loadPage,
    );

    const state = await pager.loadNextPage();

    expect(state.items.map((extension) => extension.id)).toEqual(['first']);
    expect(state.nextCursor).toBe('invalid-cursor');
    expect(state.hasMore).toBe(true);
    expect(state.error).toBe(invalidCursor);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });
});
