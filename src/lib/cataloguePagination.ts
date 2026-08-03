import type { ExtensionListItem, ExtensionListResponse } from './api/client';

export type CatalogueItem = {
  id: string;
};

export type CataloguePage<Item extends CatalogueItem = ExtensionListItem> = {
  result: Item[];
  pagination: ExtensionListResponse['pagination'];
};

export type CataloguePageFilters = {
  type?: string;
  developer_id?: string;
  limit?: number;
};

export type CataloguePageRequest = CataloguePageFilters & {
  cursor: string;
};

export type CataloguePagerState<
  Item extends CatalogueItem = ExtensionListItem,
> = {
  items: Item[];
  nextCursor: string | null;
  hasMore: boolean;
  isLoading: boolean;
  error: unknown | null;
};

export type CataloguePageLoader<
  Item extends CatalogueItem = ExtensionListItem,
> = (request: CataloguePageRequest) => Promise<CataloguePage<Item>>;

export function createCataloguePager<
  Item extends CatalogueItem = ExtensionListItem,
>(
  firstPage: CataloguePage<Item>,
  filters: CataloguePageFilters,
  loadPage: CataloguePageLoader<Item>,
  initialIds: string[] = [],
) {
  let state = stateFromPage(firstPage);
  const knownIds = new Set([
    ...initialIds.map((id) => id.toLowerCase()),
    ...state.items.map((item) => item.id.toLowerCase()),
  ]);
  let inFlight: Promise<CataloguePagerState<Item>> | null = null;

  return {
    getState(): CataloguePagerState<Item> {
      return state;
    },

    loadNextPage(): Promise<CataloguePagerState<Item>> {
      if (inFlight) {
        return inFlight;
      }

      if (!state.hasMore || state.nextCursor === null) {
        return Promise.resolve(state);
      }

      const request: CataloguePageRequest = {
        ...filters,
        cursor: state.nextCursor,
      };

      const requestPromise = (async () => {
        state = {
          ...state,
          isLoading: true,
          error: null,
        };

        try {
          const page = await loadPage(request);
          state = {
            ...appendPage(state, page, knownIds),
            isLoading: false,
          };
        } catch (error) {
          // Keep the loaded items and cursor. A user-initiated retry can use
          // the same cursor, while an invalid cursor is surfaced as an error
          // instead of silently starting over at page one.
          state = {
            ...state,
            isLoading: false,
            error,
          };
        }

        return state;
      })();

      inFlight = requestPromise.finally(() => {
        inFlight = null;
      });

      return inFlight;
    },
  };
}

export function createCataloguePagerFromIds<
  Item extends CatalogueItem = ExtensionListItem,
>(
  initialIds: string[],
  pagination: CataloguePage<Item>['pagination'],
  filters: CataloguePageFilters,
  loadPage: CataloguePageLoader<Item>,
) {
  return createCataloguePager<Item>(
    { result: [], pagination },
    filters,
    loadPage,
    initialIds,
  );
}

export function stateFromPage<Item extends CatalogueItem = ExtensionListItem>(
  page: CataloguePage<Item>,
): CataloguePagerState<Item> {
  return {
    items: [...page.result],
    nextCursor: page.pagination.next_cursor,
    hasMore: hasNextPage(page.pagination),
    isLoading: false,
    error: null,
  };
}

export function appendPage<Item extends CatalogueItem = ExtensionListItem>(
  state: CataloguePagerState<Item>,
  page: CataloguePage<Item>,
  knownIds = new Set(state.items.map((item) => item.id.toLowerCase())),
): CataloguePagerState<Item> {
  const newItems = page.result.filter((item) => {
    const key = item.id.toLowerCase();
    if (knownIds.has(key)) {
      return false;
    }
    knownIds.add(key);
    return true;
  });

  return {
    items: [...state.items, ...newItems],
    nextCursor: page.pagination.next_cursor,
    hasMore: hasNextPage(page.pagination),
    isLoading: false,
    error: null,
  };
}

function hasNextPage(pagination: ExtensionListResponse['pagination']): boolean {
  return (
    pagination.has_more &&
    pagination.next_cursor !== null &&
    pagination.next_cursor.length > 0
  );
}
