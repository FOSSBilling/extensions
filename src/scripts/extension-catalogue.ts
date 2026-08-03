import {
  createCataloguePager,
  type CataloguePageRequest,
} from '@/lib/cataloguePagination';
import type {
  ExtensionListItem,
  ExtensionListResponse,
} from '@/lib/extensionsApi';

const DEFAULT_PAGE_LIMIT = 50;

type CatalogueErrorBody = {
  error?: {
    message?: string;
  };
};

function isExtensionListResponse(
  value: unknown,
): value is ExtensionListResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const page = value as {
    result?: unknown;
    pagination?: {
      next_cursor?: unknown;
      has_more?: unknown;
    };
  };

  return (
    Array.isArray(page.result) &&
    page.pagination !== undefined &&
    (typeof page.pagination.next_cursor === 'string' ||
      page.pagination.next_cursor === null) &&
    typeof page.pagination.has_more === 'boolean'
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unable to load more extensions. Please try again.';
}

async function loadPage(
  apiUrl: string,
  request: CataloguePageRequest,
): Promise<ExtensionListResponse> {
  const params = new URLSearchParams();
  params.set('limit', String(request.limit ?? DEFAULT_PAGE_LIMIT));
  if (request.type !== undefined) {
    params.set('type', request.type);
  }
  if (request.developer_id !== undefined) {
    params.set('developer_id', request.developer_id);
  }
  // Cursors are opaque. URLSearchParams performs transport encoding only;
  // the cursor value itself is passed through unchanged.
  params.set('cursor', request.cursor);

  const response = await fetch(`${apiUrl}?${params.toString()}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('The extensions API returned an unexpected response.');
  }

  if (!response.ok) {
    const message = (body as CatalogueErrorBody | null)?.error?.message;
    throw new Error(
      message || `The extensions API returned ${response.status}.`,
    );
  }

  if (!isExtensionListResponse(body)) {
    throw new Error('The extensions API returned an unexpected response.');
  }

  return body;
}

function makeCard(item: ExtensionListItem): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = `/extension/${encodeURIComponent(item.id)}`;
  link.className = 'block';
  link.dataset.extensionId = item.id;

  const article = document.createElement('article');
  article.className = 'card hover:bg-muted/50 transition-colors h-full';

  const section = document.createElement('section');
  section.className = 'flex items-start space-x-4';

  const iconContainer = document.createElement('div');
  iconContainer.className = 'p-2 bg-primary/10 rounded-lg';
  if (item.icon_url) {
    const icon = document.createElement('img');
    icon.src = item.icon_url;
    icon.className = 'w-10 h-10';
    icon.alt = `${item.name} icon`;
    iconContainer.appendChild(icon);
  }

  const content = document.createElement('div');
  content.className = 'flex-1 min-w-0';

  const heading = document.createElement('div');
  heading.className = 'flex items-baseline space-x-2';

  const name = document.createElement('h3');
  name.className = 'text-xl font-semibold leading-none tracking-tight';
  name.textContent = item.name;

  const version = document.createElement('span');
  version.className = 'text-sm text-muted-foreground';
  version.textContent = `v${item.version || 'unknown'}`;

  const description = document.createElement('p');
  description.className = 'text-sm text-muted-foreground mt-1 truncate';
  description.textContent = item.description;

  heading.appendChild(name);
  heading.appendChild(version);
  content.appendChild(heading);
  content.appendChild(description);
  section.appendChild(iconContainer);
  section.appendChild(content);
  article.appendChild(section);
  link.appendChild(article);

  return link;
}

function installCatalogue(root: HTMLElement): void {
  const loadMore = root.querySelector<HTMLButtonElement>('[data-load-more]');
  const status = root.querySelector<HTMLElement>('[data-catalogue-status]');
  const grid = root.querySelector<HTMLElement>('[data-extension-grid]');
  const emptyState = root.querySelector<HTMLElement>('[data-empty-catalogue]');

  if (!loadMore || !status || !grid) {
    return;
  }

  const initialItems = Array.from(
    grid.querySelectorAll<HTMLElement>('[data-extension-id]'),
  ).map(
    (card) => ({ id: card.dataset.extensionId ?? '' }) as ExtensionListItem,
  );
  const firstPage: ExtensionListResponse = {
    result: initialItems,
    pagination: {
      next_cursor: loadMore.dataset.nextCursor ?? null,
      has_more: root.dataset.hasMore === 'true',
    },
  };
  const filters = {
    type: root.dataset.type as ExtensionListItem['type'] | undefined,
    developer_id: root.dataset.developerId,
    limit: Number(root.dataset.limit) || DEFAULT_PAGE_LIMIT,
  };
  const pager = createCataloguePager(firstPage, filters, (request) =>
    loadPage(root.dataset.apiUrl ?? '/api/extensions', request),
  );

  const updateControls = (itemsBeforeLoad: number) => {
    const state = pager.getState();
    const newItems = state.items.slice(itemsBeforeLoad);
    newItems.forEach((item) => grid.appendChild(makeCard(item)));
    if (emptyState && state.items.length > 0) {
      emptyState.hidden = true;
    }

    loadMore.disabled = state.isLoading;
    loadMore.setAttribute('aria-busy', String(state.isLoading));
    loadMore.textContent = state.isLoading
      ? 'Loading extensions…'
      : state.error
        ? 'Restart catalogue'
        : 'Load more extensions';

    if (!state.hasMore || state.nextCursor === null) {
      loadMore.hidden = true;
      status.textContent = 'All extensions loaded.';
    } else if (state.error) {
      loadMore.hidden = false;
      status.textContent = getErrorMessage(state.error);
    } else if (!state.isLoading) {
      loadMore.hidden = false;
      status.textContent = '';
    }

    if (!state.isLoading && state.error) {
      loadMore.disabled = false;
    }
    if (state.nextCursor !== null) {
      loadMore.dataset.nextCursor = state.nextCursor;
    }
  };

  loadMore.addEventListener('click', async () => {
    if (loadMore.disabled || loadMore.hidden) {
      return;
    }

    if (pager.getState().error) {
      // A failed cursor is not safe to retry blindly. Reloading intentionally
      // starts from the first page with the active filters.
      window.location.reload();
      return;
    }

    const itemsBeforeLoad = pager.getState().items.length;
    const request = pager.loadNextPage();
    updateControls(itemsBeforeLoad);
    await request;
    updateControls(itemsBeforeLoad);
  });
}

const catalogue = document.querySelector<HTMLElement>(
  '[data-extension-catalogue]',
);
if (catalogue) {
  installCatalogue(catalogue);
}
