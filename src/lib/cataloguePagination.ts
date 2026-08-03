import type {
  ExtensionCatalogueFilters,
  ExtensionListItem,
  ExtensionListResponse,
} from './extensionsApi';

export type CataloguePageRequest = Omit<ExtensionCatalogueFilters, 'cursor'> & {
  cursor: string;
};

export type CataloguePagerState = {
  items: ExtensionListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  isLoading: boolean;
  error: unknown | null;
};

export type CataloguePageLoader = (
  request: CataloguePageRequest,
) => Promise<ExtensionListResponse>;

export function createCataloguePager(
  firstPage: ExtensionListResponse,
  filters: Omit<ExtensionCatalogueFilters, 'cursor'>,
  loadPage: CataloguePageLoader,
) {
  let state = stateFromPage(firstPage);
  let inFlight: Promise<CataloguePagerState> | null = null;

  return {
    getState(): CataloguePagerState {
      return state;
    },

    loadNextPage(): Promise<CataloguePagerState> {
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
            ...appendPage(state, page),
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

export function stateFromPage(
  page: ExtensionListResponse,
): CataloguePagerState {
  return {
    items: [...page.result],
    nextCursor: page.pagination.next_cursor,
    hasMore: page.pagination.has_more && page.pagination.next_cursor !== null,
    isLoading: false,
    error: null,
  };
}

export function appendPage(
  state: CataloguePagerState,
  page: ExtensionListResponse,
): CataloguePagerState {
  const knownIds = new Set(state.items.map((item) => item.id.toLowerCase()));
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
    hasMore: page.pagination.has_more && page.pagination.next_cursor !== null,
    isLoading: false,
    error: null,
  };
}
