// Client-side behaviour for /account/admin/revisions: on-demand
// "compare with live" (one GET /api/admin/revision-detail per expanded row,
// cached per revision id) plus wiring the row buttons to the single shared
// approve/reject dialog pair. Kept in a module (rather than inline in the
// .astro file) so it gets full TypeScript checking like any other lib file.

import { renderMarkdown } from '@/lib/markdown';
import { isSafeHttpUrl } from '@/lib/safe-url';
import { initTruncateToggles } from '@/lib/truncate-toggles';
import {
  DIFF_FIELDS,
  FIELD_LABELS,
  MARKDOWN_SCROLL_CLASS,
  TRUNCATE_AT,
  TRUNCATE_EXPAND_LABEL,
  URL_FIELDS,
  fieldChanged,
  fieldDisplay,
  fieldUrl,
} from '@/lib/revision-diff-shared';

type PublishedContent = {
  type?: string;
  name?: string;
  version?: string;
  description?: string;
  website?: string;
  download_url?: string;
  icon_url?: string;
  readme?: string;
  source?: { type?: string; repo?: string };
  license?: { name?: string; spdx_id?: string; URL?: string };
  releases?: Array<{ tag?: string }>;
};

interface RevisionDetailResult {
  published: PublishedContent | null;
  revision: PublishedContent;
}

// Uniqueness for aria-controls targets within one page's diff tables.
let truncateSequence = 0;

function markdownCell(value: string, className: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = className;
  const body = document.createElement('div');
  body.className = MARKDOWN_SCROLL_CLASS;
  body.innerHTML = renderMarkdown(value);
  td.appendChild(body);
  return td;
}

function valueCell(
  value: string | null,
  className: string,
  emptyLabel: string,
  href: string | null = null,
): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = className;
  if (value === null) {
    td.textContent = emptyLabel;
    return td;
  }
  // Explicit hrefs (source row) and URL fields render as full clickable
  // links — validated scheme first, anything else falls through to plain
  // text below. Links are never truncated: a 400+ char URL is vanishingly
  // rare, and clipping an href's visible text while keeping the full target
  // would mislead reviewers.
  const link = href && isSafeHttpUrl(href) ? href : null;
  if (link) {
    const anchor = document.createElement('a');
    anchor.href = link;
    anchor.textContent = value;
    td.appendChild(anchor);
    return td;
  }
  if (value.length <= TRUNCATE_AT) {
    td.textContent = value;
    return td;
  }
  // Same markup protocol as TruncatedText.astro, so the shared delegation
  // (initTruncateToggles) wires the toggle. Like TruncatedText, the toggle
  // links to the region it expands via aria-controls.
  const fullId = `truncate-full-${++truncateSequence}`;
  const short = document.createElement('span');
  short.setAttribute('data-truncate-short', '');
  short.textContent = `${value.slice(0, TRUNCATE_AT)}…`;
  const full = document.createElement('span');
  full.setAttribute('data-truncate-full', '');
  full.id = fullId;
  full.textContent = value;
  full.hidden = true;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn ml-2';
  toggle.setAttribute('data-size', 'sm');
  toggle.setAttribute('data-variant', 'ghost');
  toggle.setAttribute('data-truncate-toggle', '');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', fullId);
  toggle.textContent = TRUNCATE_EXPAND_LABEL;
  td.appendChild(short);
  td.appendChild(document.createTextNode(' '));
  td.appendChild(full);
  td.appendChild(toggle);
  return td;
}

function renderDiff(
  body: Element,
  hint: HTMLElement | null,
  revision: PublishedContent,
  published: PublishedContent | null,
): void {
  body.innerHTML = '';
  const isNew = !published;
  let changed = 0;
  for (const field of DIFF_FIELDS) {
    const label = FIELD_LABELS[field];
    const oldValue = fieldDisplay(field, published);
    const newValue = fieldDisplay(field, revision);
    const isChanged = fieldChanged(field, published, revision, isNew);
    if (isChanged) changed += 1;
    const tr = document.createElement('tr');
    tr.className =
      'border-t border-border align-top' + (isChanged ? ' bg-muted/50' : '');
    const tdField = document.createElement('td');
    tdField.className = 'py-1 pr-3 font-medium whitespace-nowrap';
    tdField.textContent = label + (isChanged ? ' •' : '');
    // Source and license rows link via their own URL (type-aware for
    // sources); URL fields link via their own value. Everything else
    // renders as text.
    const linkedField = field === 'source' || field === 'license';
    const oldHref = linkedField
      ? fieldUrl(field, published)
      : URL_FIELDS.has(field)
        ? oldValue
        : null;
    const newHref = linkedField
      ? fieldUrl(field, revision)
      : URL_FIELDS.has(field)
        ? newValue
        : null;
    const tdOld =
      field === 'readme' && oldValue !== null
        ? markdownCell(
            oldValue,
            'py-1 pr-3 text-muted-foreground break-all min-w-40',
          )
        : valueCell(
            oldValue,
            'py-1 pr-3 text-muted-foreground break-all min-w-40',
            isNew ? '— (New Extension)' : '—',
            oldHref,
          );
    const tdNew =
      field === 'readme' && newValue !== null
        ? markdownCell(newValue, 'py-1 break-all')
        : valueCell(newValue, 'py-1 break-all', '—', newHref);
    tr.appendChild(tdField);
    tr.appendChild(tdOld);
    tr.appendChild(tdNew);
    body.appendChild(tr);
  }
  if (hint) {
    hint.textContent = isNew
      ? 'New Extension — No Live Version to Compare Against'
      : `${changed} Field(s) Changed`;
    hint.hidden = false;
  }
}

// Detail rows immediately follow their summary row; verify the marker.
function findDetailWrap(
  button: HTMLElement,
  attribute: string,
): HTMLElement | null {
  const wrap = button.closest('tr')?.nextElementSibling;
  return wrap instanceof HTMLElement && wrap.hasAttribute(attribute)
    ? wrap
    : null;
}

export function initRevisionQueue(): void {
  initTruncateToggles();

  const detailCache = new Map<string, RevisionDetailResult>();

  document.addEventListener('click', (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;

    // Both pending and reviewed content are loaded on demand by revision id.
    const frozenBtn = target?.closest<HTMLButtonElement>('[data-frozen]');
    if (frozenBtn) {
      const wrap = findDetailWrap(frozenBtn, 'data-frozen-wrap');
      if (!wrap) return;
      const row = frozenBtn.closest('tr') as HTMLElement | null;
      const body = wrap.querySelector('[data-frozen-body]');
      const errorEl = wrap.querySelector<HTMLElement>('[data-frozen-error]');
      const extensionId = row?.dataset.extensionId ?? '';
      const revisionId = row?.dataset.revisionId ?? '';
      if (!body) return;
      if (!wrap.hidden && errorEl?.hidden !== false) {
        wrap.hidden = true;
        frozenBtn.setAttribute('aria-expanded', 'false');
        frozenBtn.textContent = frozenBtn.dataset.show ?? 'Show';
        return;
      }
      frozenBtn.disabled = true;
      frozenBtn.textContent = 'Loading Reviewed Content…';
      if (errorEl) errorEl.hidden = true;
      void (async () => {
        try {
          const key = `reviewed:${revisionId}`;
          if (!detailCache.has(key)) {
            const res = await fetch(
              `/api/admin/revision-detail?extensionId=${encodeURIComponent(extensionId)}&revisionId=${encodeURIComponent(revisionId)}`,
            );
            const json = (await res.json()) as {
              result?: RevisionDetailResult;
              error?: { message?: string };
            };
            if (!res.ok || !json.result)
              throw new Error(
                json.error?.message ?? 'Unable to load reviewed content.',
              );
            detailCache.set(key, json.result);
          }
          body.innerHTML = '';
          const revision = detailCache.get(key)!.revision;
          for (const field of DIFF_FIELDS) {
            const tr = document.createElement('tr');
            tr.className = 'border-t border-border align-top';
            const label = document.createElement('td');
            label.className = 'py-1 pr-3 font-medium';
            label.textContent = FIELD_LABELS[field];
            const value = fieldDisplay(field, revision);
            const href =
              field === 'source' || field === 'license'
                ? fieldUrl(field, revision)
                : URL_FIELDS.has(field)
                  ? value
                  : null;
            tr.appendChild(label);
            tr.appendChild(
              field === 'readme' && value !== null
                ? markdownCell(value, 'py-1 break-all')
                : valueCell(value, 'py-1 break-all', '—', href),
            );
            body.appendChild(tr);
          }
          if (errorEl) errorEl.hidden = true;
          wrap.hidden = false;
          frozenBtn.setAttribute('aria-expanded', 'true');
          frozenBtn.textContent = frozenBtn.dataset.hide ?? 'Hide';
        } catch (error) {
          if (errorEl) {
            errorEl.textContent =
              error instanceof Error
                ? error.message
                : 'Unable to load reviewed content.';
            errorEl.hidden = false;
          }
          wrap.hidden = false;
          frozenBtn.setAttribute('aria-expanded', 'true');
          frozenBtn.textContent = 'Retry';
        } finally {
          frozenBtn.disabled = false;
        }
      })();

      return;
    }

    // Pending rows: the button lives in the summary row; the detail row
    // itself is the wrap (verified by attribute). Both sides are fetched only
    // when expanded; list rows never embed revision bodies.
    const compareBtn = target?.closest<HTMLButtonElement>('[data-compare]');
    if (compareBtn) {
      const wrap = findDetailWrap(compareBtn, 'data-diff-table-wrap');
      if (!wrap) return;
      const row = compareBtn.closest('tr');
      const body = wrap.querySelector('[data-diff-body]');
      const hint = wrap.querySelector<HTMLElement>('[data-diff-hint]');
      const errorEl = wrap.querySelector<HTMLElement>('[data-diff-error]');
      const host = row as HTMLElement | null;
      const extensionId = host?.dataset.extensionId ?? '';
      const revisionId = host?.dataset.revisionId ?? '';
      if (!body) return;
      if (!wrap.hidden && errorEl?.hidden !== false) {
        wrap.hidden = true;
        compareBtn.setAttribute('aria-expanded', 'false');
        compareBtn.textContent = 'Show Changes';
        return;
      }
      compareBtn.disabled = true;
      compareBtn.textContent = 'Loading Changes…';
      if (errorEl) errorEl.hidden = true;
      void (async () => {
        try {
          const key = `compare:${revisionId}`;
          if (!detailCache.has(key)) {
            const res = await fetch(
              `/api/admin/revision-detail?extensionId=${encodeURIComponent(extensionId)}&revisionId=${encodeURIComponent(revisionId)}&compare=1`,
            );
            const json = (await res.json()) as {
              result?: RevisionDetailResult;
              error?: { message?: string };
            };
            if (!res.ok || !json.result) {
              throw new Error(
                json?.error?.message ?? 'Unable to load live version.',
              );
            }
            detailCache.set(key, json.result);
          }
          renderDiff(
            body,
            hint,
            detailCache.get(key)!.revision,
            detailCache.get(key)!.published,
          );
          wrap.hidden = false;
          compareBtn.setAttribute('aria-expanded', 'true');
          compareBtn.textContent = 'Hide Changes';
        } catch (err) {
          if (errorEl) {
            errorEl.textContent =
              err instanceof Error
                ? err.message
                : 'Unable to load live version.';
            errorEl.hidden = false;
          }
          wrap.hidden = false;
          compareBtn.setAttribute('aria-expanded', 'true');
          compareBtn.textContent = 'Retry';
        } finally {
          compareBtn.disabled = false;
        }
      })();
      return;
    }

    const approveBtn = target?.closest<HTMLElement>('[data-open-approve]');
    const rejectBtn = target?.closest<HTMLElement>('[data-open-reject]');
    const actionBtn = (approveBtn ?? rejectBtn) as
      HTMLElement | null | undefined;
    if (actionBtn) {
      const isApprove = Boolean(approveBtn);
      const dialogId = isApprove
        ? 'admin-approve-revision'
        : 'admin-reject-revision';
      const dialog = document.getElementById(
        dialogId,
      ) as HTMLDialogElement | null;
      const form = dialog?.querySelector('form');
      const titleEl = dialog?.querySelector('h2');
      if (dialog && form) {
        const extId = actionBtn.dataset.extensionId;
        const revId = actionBtn.dataset.revisionId;
        const title = actionBtn.dataset.title ?? extId;
        form.action = `/account/admin/revisions/${extId}/${revId}/${isApprove ? 'approve' : 'reject'}`;
        if (titleEl) {
          titleEl.textContent = `${isApprove ? 'Approve' : 'Reject'} "${title}"?`;
        }
        dialog.showModal();
      }
    }
  });
}
