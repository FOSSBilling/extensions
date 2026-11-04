import type { ExtensionListItem, ExtensionListResponse } from './api/client';

type DirectoryItem = {
  id: string;
};

type DirectoryPage<Item extends DirectoryItem = ExtensionListItem> = {
  result: Item[];
  pagination: ExtensionListResponse['pagination'];
};

type DirectoryPageFilters = {
  type?: string;
  developer_id?: string;
  limit?: number;
};

export type DirectoryPageRequest = DirectoryPageFilters & {
  cursor: string;
};

type DirectoryPagerState<Item extends DirectoryItem = ExtensionListItem> = {
  items: Item[];
  nextCursor: string | null;
  hasMore: boolean;
  isLoading: boolean;
  error: unknown | null;
};

type DirectoryPageLoader<Item extends DirectoryItem = ExtensionListItem> = (
  request: DirectoryPageRequest,
) => Promise<DirectoryPage<Item>>;

export function createDirectoryPager<
  Item extends DirectoryItem = ExtensionListItem,
>(
  firstPage: DirectoryPage<Item>,
  filters: DirectoryPageFilters,
  loadPage: DirectoryPageLoader<Item>,
  initialIds: string[] = [],
) {
  let state = stateFromPage(firstPage);
  const knownIds = new Set([
    ...initialIds.map((id) => id.toLowerCase()),
    ...state.items.map((item) => item.id.toLowerCase()),
  ]);
  let inFlight: Promise<DirectoryPagerState<Item>> | null = null;

  return {
    getState(): DirectoryPagerState<Item> {
      return state;
    },

    loadNextPage(): Promise<DirectoryPagerState<Item>> {
      if (inFlight) {
        return inFlight;
      }

      if (!state.hasMore || state.nextCursor === null) {
        return Promise.resolve(state);
      }

      const request: DirectoryPageRequest = {
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

export function createDirectoryPagerFromIds<
  Item extends DirectoryItem = ExtensionListItem,
>(
  initialIds: string[],
  pagination: DirectoryPage<Item>['pagination'],
  filters: DirectoryPageFilters,
  loadPage: DirectoryPageLoader<Item>,
) {
  return createDirectoryPager<Item>(
    { result: [], pagination },
    filters,
    loadPage,
    initialIds,
  );
}

export function stateFromPage<Item extends DirectoryItem = ExtensionListItem>(
  page: DirectoryPage<Item>,
): DirectoryPagerState<Item> {
  return {
    items: [...page.result],
    nextCursor: page.pagination.next_cursor,
    hasMore: hasNextPage(page.pagination),
    isLoading: false,
    error: null,
  };
}

export function appendPage<Item extends DirectoryItem = ExtensionListItem>(
  state: DirectoryPagerState<Item>,
  page: DirectoryPage<Item>,
  knownIds = new Set(state.items.map((item) => item.id.toLowerCase())),
): DirectoryPagerState<Item> {
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

// Whether another page exists at all. Shared with the server-rendered
// directory wrappers, whose data-has-more attribute seeds the client pager.
export function hasNextPage(
  pagination: ExtensionListResponse['pagination'],
): boolean {
  return (
    pagination.has_more &&
    pagination.next_cursor !== null &&
    pagination.next_cursor.length > 0
  );
}
