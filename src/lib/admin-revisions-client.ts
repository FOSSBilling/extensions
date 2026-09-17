// Client-side behaviour for /account/admin/revisions: on-demand
// "compare with live" (one GET /api/admin/revision-detail per expanded card,
// cached per extension id) plus wiring the card buttons to the single shared
// approve/reject dialog pair. Kept in a module (rather than inline in the
// .astro file) so it gets full TypeScript checking like any other lib file.

import { renderMarkdown } from '@/lib/markdown';
import { isSafeHttpUrl } from '@/lib/safe-url';

interface PublishedContent {
  type?: string;
  name?: string;
  version?: string;
  description?: string;
  website?: string;
  download_url?: string;
  icon_url?: string;
  readme?: string;
  source?: { type?: string; repo?: string };
  license?: { name?: string; spdx_id?: string };
  releases?: Array<{ tag?: string }>;
}

interface RevisionDetailResult {
  published: PublishedContent | null;
}

const FIELDS: Array<[keyof PublishedContent, string]> = [
  ['name', 'Name'],
  ['type', 'Type'],
  ['version', 'Version'],
  ['description', 'Description'],
  ['website', 'Website'],
  ['download_url', 'Download URL'],
  ['icon_url', 'Icon URL'],
  ['source', 'Source Repo'],
  ['license', 'License'],
  ['releases', 'Releases'],
  ['readme', 'Readme'],
];

function scalar(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function licenseLabel(license: PublishedContent['license']): string | null {
  if (
    !license ||
    typeof license.name !== 'string' ||
    license.name.length === 0
  ) {
    return null;
  }
  return license.spdx_id
    ? `${license.name} (${license.spdx_id})`
    : license.name;
}

function sourceLabel(source: PublishedContent['source']): string | null {
  if (!source || typeof source.repo !== 'string') return null;
  return source.repo.length > 0 ? source.repo : null;
}

// Mirrors repositoryURL (@/types) + sourceUrl (revision-diff.ts) without
// importing them: @/types pulls semver into the browser bundle for six lines
// of switch. Keeps GitLab/custom sources linking correctly.
function sourceHref(source: PublishedContent['source']): string | null {
  if (
    !source ||
    typeof source.repo !== 'string' ||
    source.repo.length === 0 ||
    (source.type !== 'github' &&
      source.type !== 'gitlab' &&
      source.type !== 'custom')
  ) {
    return null;
  }
  switch (source.type) {
    case 'github':
      return `https://github.com/${source.repo}`;
    case 'gitlab':
      return `https://gitlab.com/${source.repo}`;
    case 'custom':
      return source.repo;
  }
}

function releasesLabel(releases: PublishedContent['releases']): string | null {
  if (!releases) return null;
  if (releases.length === 0) return '—';
  const tags = releases
    .map((r) => r?.tag)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .slice(0, 5);
  return tags.length > 0
    ? `${releases.length} release(s): ${tags.join(', ')}${releases.length > 5 ? ', …' : ''}`
    : `${releases.length} release(s)`;
}

function fieldValue(
  field: keyof PublishedContent,
  obj: PublishedContent | null,
): string | null {
  if (!obj) return null;
  if (field === 'license') return licenseLabel(obj.license);
  if (field === 'source') return sourceLabel(obj.source);
  if (field === 'releases') return releasesLabel(obj.releases);
  return scalar(obj[field]);
}

const TRUNCATE_AT = 400;

function markdownCell(value: string, className: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = className;
  const body = document.createElement('div');
  body.className =
    'markdown-body break-normal max-h-72 overflow-y-auto overscroll-contain';
  body.innerHTML = renderMarkdown(value);
  td.appendChild(body);
  return td;
}

const URL_FIELDS: ReadonlySet<string> = new Set([
  'website',
  'download_url',
  'icon_url',
]);

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
  const short = document.createElement('span');
  short.textContent = `${value.slice(0, TRUNCATE_AT)}…`;
  const full = document.createElement('span');
  full.textContent = value;
  full.hidden = true;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn ml-2';
  toggle.setAttribute('data-size', 'sm');
  toggle.setAttribute('data-variant', 'ghost');
  toggle.textContent = 'Show More';
  toggle.addEventListener('click', () => {
    const expanded = full.hidden;
    full.hidden = !expanded;
    short.hidden = expanded;
    toggle.textContent = expanded ? 'Show Less' : 'Show More';
  });
  td.appendChild(short);
  td.appendChild(document.createTextNode(' '));
  td.appendChild(full);
  td.appendChild(toggle);
  return td;
}

function renderDiff(
  card: HTMLElement,
  published: PublishedContent | null,
): void {
  const body = card.querySelector('[data-diff-body]');
  const wrap = card.querySelector('[data-diff-table-wrap]');
  const hint = card.querySelector<HTMLElement>('[data-diff-hint]');
  if (!body || !wrap) return;
  let revision: PublishedContent = {};
  try {
    revision = JSON.parse(
      card.dataset.revisionJson ?? '{}',
    ) as PublishedContent;
  } catch {
    revision = {};
  }
  body.innerHTML = '';
  const isNew = !published;
  let changed = 0;
  for (const [field, label] of FIELDS) {
    const oldValue = fieldValue(field, published);
    const newValue = fieldValue(field, revision);
    const isChanged = isNew ? newValue !== null : oldValue !== newValue;
    if (isChanged) changed += 1;
    const tr = document.createElement('tr');
    tr.className =
      'border-t border-border align-top' + (isChanged ? ' bg-muted/50' : '');
    const tdField = document.createElement('td');
    tdField.className = 'py-1 pr-3 font-medium whitespace-nowrap';
    tdField.textContent = label + (isChanged ? ' •' : '');
    // Source rows link via the repository URL (type-aware); URL fields link
    // via their own value. Everything else renders as text.
    const oldHref =
      field === 'source'
        ? sourceHref(published?.source)
        : URL_FIELDS.has(field)
          ? oldValue
          : null;
    const newHref =
      field === 'source'
        ? sourceHref(revision.source)
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
  (wrap as HTMLElement).hidden = false;
  if (hint) {
    hint.textContent = isNew
      ? 'New Extension — No Live Version to Compare Against'
      : `${changed} Field(s) Changed`;
    hint.hidden = false;
  }
}

export function initRevisionQueue(): void {
  const detailCache = new Map<string, PublishedContent | null>();

  document.addEventListener('click', (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;

    // Frozen content is server-rendered — this just toggles it, with no fetch
    // involved (unlike [data-compare] below). Works in two shapes: queue
    // cards (wrap inside the card scope) and audit table rows (wrap is the
    // next sibling row). Labels come from data-show/data-hide.
    const frozenBtn = target?.closest<HTMLButtonElement>('[data-frozen]');
    if (frozenBtn) {
      const cardScope = frozenBtn.closest('[data-revision-card]');
      const rowScope = cardScope ?? frozenBtn.closest('tr');
      const wrap = cardScope
        ? rowScope?.querySelector('[data-frozen-wrap]')
        : rowScope?.nextElementSibling;
      if (
        !(wrap instanceof HTMLElement) ||
        !wrap.hasAttribute('data-frozen-wrap')
      ) {
        return;
      }
      const showing = !wrap.hidden;
      wrap.hidden = showing;
      frozenBtn.textContent = showing
        ? (frozenBtn.dataset.show ?? 'Show')
        : (frozenBtn.dataset.hide ?? 'Hide');
      return;
    }

    const compareBtn = target?.closest<HTMLButtonElement>('[data-compare]');
    if (compareBtn) {
      const card = compareBtn.closest<HTMLElement>('[data-revision-card]');
      if (!card) return;
      const extensionId = card.dataset.extensionId ?? '';
      const errorEl = card.querySelector<HTMLElement>('[data-diff-error]');
      const wrap = card.querySelector<HTMLElement>('[data-diff-table-wrap]');
      if (wrap && !wrap.hidden) {
        wrap.hidden = true;
        compareBtn.textContent = 'Show Changes';
        return;
      }
      compareBtn.disabled = true;
      compareBtn.textContent = 'Loading Changes…';
      if (errorEl) errorEl.hidden = true;
      void (async () => {
        try {
          if (!detailCache.has(extensionId)) {
            const res = await fetch(
              `/api/admin/revision-detail?extensionId=${encodeURIComponent(extensionId)}`,
            );
            const json = (await res.json()) as {
              result?: RevisionDetailResult;
              error?: { message?: string };
            };
            if (!res.ok) {
              throw new Error(
                json?.error?.message ?? 'Unable to load live version.',
              );
            }
            detailCache.set(extensionId, json.result?.published ?? null);
          }
          renderDiff(card, detailCache.get(extensionId) ?? null);
          compareBtn.textContent = 'Hide Changes';
        } catch (err) {
          if (errorEl) {
            errorEl.textContent =
              err instanceof Error
                ? err.message
                : 'Unable to load live version.';
            errorEl.hidden = false;
          }
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
