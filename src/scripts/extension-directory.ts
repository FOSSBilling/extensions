// Client-side behaviour for the directory's Load More control. Appended
// cards come from /api/extensions/cards, which renders the same
// ExtensionCard component as the server-rendered grid — card markup and
// server-signed icon URLs cannot drift between the first page and the rest.
// Kept in a module (rather than inline in the .astro file) so it gets full
// TypeScript checking like any other lib file.

import {
  createDirectoryPagerFromIds,
  type DirectoryPageRequest,
} from '@/lib/directory-pagination';
import type { ExtensionListResponse } from '@/lib/api/client';

const DEFAULT_PAGE_LIMIT = 50;

// A rendered card and its extension id. The id backs the pager's dedupe;
// the markup is appended as-is.
type DirectoryCard = {
  id: string;
  html: string;
};

type DirectoryCardPage = {
  result: DirectoryCard[];
  pagination: ExtensionListResponse['pagination'];
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unable to load more extensions. Please try again.';
}

async function loadPage(
  apiUrl: string,
  request: DirectoryPageRequest,
): Promise<DirectoryCardPage> {
  const params = new URLSearchParams();
  params.set('limit', String(request.limit ?? DEFAULT_PAGE_LIMIT));
  if (request.type !== undefined) {
    params.set('type', request.type);
  }
  if (request.developer_identifier !== undefined) {
    params.set('developer_identifier', request.developer_identifier);
  }
  // Cursors are opaque. URLSearchParams performs transport encoding only;
  // the cursor value itself is passed through unchanged.
  params.set('cursor', request.cursor);

  const response = await fetch(`${apiUrl}?${params.toString()}`);
  const html = await response.text();

  const fragment = document.createElement('template');
  // Parsing untrusted HTML? The fragment endpoint is this site's own render
  // of ExtensionCard; template parsing never executes scripts anyway.
  fragment.innerHTML = html;

  if (!response.ok) {
    const errorEl = fragment.content.querySelector<HTMLElement>(
      '[data-directory-error]',
    );
    throw new Error(
      errorEl?.dataset.directoryError ??
        `The extensions API returned ${response.status}.`,
    );
  }

  const wrapper = fragment.content.querySelector<HTMLElement>(
    '[data-directory-page]',
  );
  if (!wrapper) {
    throw new Error('The extensions API returned an unexpected response.');
  }

  const cards = Array.from(
    wrapper.querySelectorAll<HTMLElement>('[data-extension-id]'),
  ).map((card) => ({
    id: card.dataset.extensionId ?? '',
    html: card.outerHTML,
  }));

  return {
    result: cards,
    pagination: {
      next_cursor: wrapper.dataset.nextCursor || null,
      has_more: wrapper.dataset.hasMore === 'true',
    },
  };
}

function installDirectory(root: HTMLElement): void {
  const loadMore = root.querySelector<HTMLButtonElement>('[data-load-more]');
  const status = root.querySelector<HTMLElement>('[data-directory-status]');
  const grid = root.querySelector<HTMLElement>('[data-extension-grid]');
  const emptyState = root.querySelector<HTMLElement>('[data-empty-directory]');

  if (!loadMore || !status || !grid) {
    return;
  }

  const initialIds = Array.from(
    grid.querySelectorAll<HTMLElement>('[data-extension-id]'),
  )
    .map((card) => card.dataset.extensionId ?? '')
    .filter(Boolean);
  const pagination: DirectoryCardPage['pagination'] = {
    next_cursor: loadMore.dataset.nextCursor ?? null,
    has_more: root.dataset.hasMore === 'true',
  };
  const filters = {
    type: root.dataset.type || undefined,
    developer_identifier: root.dataset.developerId,
    limit: Number(root.dataset.limit) || DEFAULT_PAGE_LIMIT,
  };
  const pager = createDirectoryPagerFromIds<DirectoryCard>(
    initialIds,
    pagination,
    filters,
    (request) =>
      loadPage(root.dataset.apiUrl ?? '/api/extensions/cards', request),
  );

  const updateControls = () => {
    const state = pager.getState();
    if (emptyState && state.items.length > 0) {
      emptyState.hidden = true;
    }

    loadMore.disabled = state.isLoading;
    loadMore.setAttribute('aria-busy', String(state.isLoading));
    loadMore.textContent = state.isLoading
      ? 'Loading extensions…'
      : state.error
        ? 'Restart directory'
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

    const cardsBefore = pager.getState().items.length;
    const request = pager.loadNextPage();
    updateControls();
    await request;
    const newCards = pager.getState().items.slice(cardsBefore);
    if (newCards.length > 0) {
      const template = document.createElement('template');
      template.innerHTML = newCards.map((card) => card.html).join('');
      const nodes = Array.from(template.content.children);
      for (const node of nodes) {
        grid.appendChild(node);
      }
    }
    updateControls();
  });
}

if (typeof document !== 'undefined') {
  const directory = document.querySelector<HTMLElement>(
    '[data-extension-directory]',
  );
  if (directory) {
    installDirectory(directory);
  }
}
