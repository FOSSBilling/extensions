import {
  createCataloguePagerFromIds,
  type CataloguePageRequest,
} from '@/lib/cataloguePagination';
import type {
  ExtensionListItem,
  ExtensionListResponse,
} from '@/lib/api/client';

const DEFAULT_PAGE_LIMIT = 50;

type CatalogueCardItem = Pick<
  ExtensionListItem,
  'id' | 'name' | 'description' | 'version' | 'icon_url'
>;

type CatalogueCardPage = {
  result: CatalogueCardItem[];
  pagination: ExtensionListResponse['pagination'];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCatalogueCardItem(value: unknown): value is CatalogueCardItem {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.version === 'string' &&
    (value.icon_url === undefined || typeof value.icon_url === 'string')
  );
}

export function isCatalogueCardPage(
  value: unknown,
): value is CatalogueCardPage {
  if (!isRecord(value) || !isRecord(value.pagination)) {
    return false;
  }

  return (
    Array.isArray(value.result) &&
    value.result.every(isCatalogueCardItem) &&
    (typeof value.pagination.next_cursor === 'string' ||
      value.pagination.next_cursor === null) &&
    typeof value.pagination.has_more === 'boolean'
  );
}

function catalogueErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }

  return typeof value.error.message === 'string'
    ? value.error.message
    : undefined;
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
): Promise<CatalogueCardPage> {
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
    const message = catalogueErrorMessage(body);
    throw new Error(
      message || `The extensions API returned ${response.status}.`,
    );
  }

  if (!isCatalogueCardPage(body)) {
    throw new Error('The extensions API returned an unexpected response.');
  }

  return body;
}

function makeCard(item: CatalogueCardItem): HTMLAnchorElement {
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

  const initialIds = Array.from(
    grid.querySelectorAll<HTMLElement>('[data-extension-id]'),
  )
    .map((card) => card.dataset.extensionId ?? '')
    .filter(Boolean);
  const pagination: CatalogueCardPage['pagination'] = {
    next_cursor: loadMore.dataset.nextCursor ?? null,
    has_more: root.dataset.hasMore === 'true',
  };
  const filters = {
    type: root.dataset.type || undefined,
    developer_id: root.dataset.developerId,
    limit: Number(root.dataset.limit) || DEFAULT_PAGE_LIMIT,
  };
  const pager = createCataloguePagerFromIds(
    initialIds,
    pagination,
    filters,
    (request) => loadPage(root.dataset.apiUrl ?? '/api/extensions', request),
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

if (typeof document !== 'undefined') {
  const catalogue = document.querySelector<HTMLElement>(
    '[data-extension-catalogue]',
  );
  if (catalogue) {
    installCatalogue(catalogue);
  }
}
