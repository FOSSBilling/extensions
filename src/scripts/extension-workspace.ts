import {
  applyExtensionDraft,
  releaseFromFields,
  type ExtensionDraft,
  type DraftSection,
} from '@/lib/extension-draft';
import { latestRelease, releasesDescending } from '@/lib/releases';
import type { ExtensionUpdate } from '@/lib/api/client';
import { EXTENSION_TYPE_LABELS, repositoryURL } from '@/types';
import { repositoryInputUrl } from '@/lib/repository';
import { licenseUrl } from '@/lib/license';
import { isSafeHttpUrl } from '@/lib/safe-url';
import { renderMarkdown } from '@/lib/markdown';

export function initExtensionWorkspace() {
  const container = document.querySelector<HTMLElement>(
    '[data-extension-workspace]',
  );
  if (!container) return;
  const root = container;
  const configNode = root.querySelector('[data-draft-config]');
  if (!configNode) return;
  const config = JSON.parse(configNode.textContent!) as {
    base: ExtensionUpdate;
    baselineHash: string;
    pendingRevisionId?: string;
    submitLabel: string;
    key: string;
    submitUrl: string;
    baseUrl: string;
  };
  const find = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const message = find<HTMLElement>('[data-draft-error]');
  const submit = find<HTMLButtonElement>('[data-submit-draft]');
  const discard = find<HTMLButtonElement>('[data-discard-draft]');
  const status = find<HTMLElement>('[data-draft-status]');
  const headerName = document.querySelector<HTMLElement>(
    '[data-extension-name]',
  );
  const fallbackName = headerName?.textContent?.trim() ?? '';
  const draftBar = find<HTMLElement>('[data-draft-bar]');
  const unsaved = new Set<HTMLFormElement>();
  const empty = (): ExtensionDraft => ({
    baselineHash: config.baselineHash,
    pendingRevisionId: config.pendingRevisionId,
    sections: {},
  });
  let draft = empty();
  let stored = false;
  let blocked = false;
  let busy = false;
  const error = (text: string) => {
    message.textContent = text;
    message.hidden = !text;
  };
  try {
    const raw = localStorage.getItem(config.key);
    if (raw) {
      stored = true;
      draft = JSON.parse(raw);
      delete (draft as ExtensionDraft & { currentRelease?: unknown })
        .currentRelease;
      for (const section of Object.values(draft.sections)) {
        if (section && !('source_url' in section) && 'source_repo' in section) {
          section.source_url = repositoryInputUrl(section);
        }
      }
      applyExtensionDraft(config.base, draft);
      if (
        draft.baselineHash !== config.baselineHash ||
        draft.pendingRevisionId !== config.pendingRevisionId
      ) {
        blocked = true;
        error(
          'The extension changed since this draft was started. Your draft is kept here so you can copy your changes. Discard it to start from the latest version.',
        );
      }
    }
  } catch {
    blocked = true;
    error(
      'This browser’s draft storage could not be read. Your saved draft has not been removed. Check browser storage or discard the draft to start again.',
    );
    draft = empty();
  }

  const fields = (form: HTMLFormElement) =>
    Object.fromEntries(
      [...new FormData(form)].filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  function content() {
    return applyExtensionDraft(config.base, draft);
  }
  function updateButtons() {
    let changed = false;
    try {
      changed = JSON.stringify(content()) !== JSON.stringify(config.base);
    } catch {
      /* Invalid stored draft stays blocked. */
    }
    submit.disabled = busy || blocked || !changed || unsaved.size > 0;
    discard.disabled = busy || (!stored && !unsaved.size && !blocked);
    draftBar.hidden = !changed && !unsaved.size && !blocked && !busy;
    status.textContent = blocked
      ? 'Draft Needs Attention'
      : unsaved.size
        ? 'Unsaved Section Edits'
        : changed
          ? 'Draft Saved in This Browser'
          : 'No Local Changes';
  }
  function save(next: ExtensionDraft) {
    if (blocked || busy)
      throw new Error(
        'Reload or discard the draft before saving more changes.',
      );
    applyExtensionDraft(config.base, next);
    // Only announce a save after storage succeeds. Never silently lose edits
    // when private browsing, quotas, or disabled storage prevents persistence.
    try {
      localStorage.setItem(config.key, JSON.stringify(next));
    } catch {
      throw new Error(
        'Your draft could not be saved in this browser. Your edits are still in the form. Check browser storage and try again.',
      );
    }
    draft = next;
    stored = true;
    error('');
  }
  function text(selector: string, value: string) {
    root
      .querySelectorAll<HTMLElement>(selector)
      .forEach((node) => (node.textContent = value));
  }
  function refresh() {
    const current = content();
    if (headerName) headerName.textContent = current.name || fallbackName;
    text('[data-preview-description]', current.description);
    text('[data-preview-type]', EXTENSION_TYPE_LABELS[current.type]);
    text('[data-preview-website]', current.homepage_url ?? '');
    const websiteLink = find<HTMLAnchorElement>('[data-preview-website]');
    if (websiteLink) {
      const safe = isSafeHttpUrl(current.homepage_url ?? '');
      if (safe) websiteLink.href = current.homepage_url ?? '';
      else websiteLink.removeAttribute('href');
      websiteLink.classList.toggle('underline', safe);
    }
    text('[data-preview-icon]', current.icon_url || '');
    const iconUrlDetail = find<HTMLElement>('[data-icon-url-detail]');
    if (iconUrlDetail) iconUrlDetail.hidden = !current.icon_url;

    const sourceUrl = repositoryURL(current.source);
    const github = current.source.type === 'github';
    text('[data-preview-source]', github ? current.source.repo : sourceUrl);
    const sourceLink = find<HTMLAnchorElement>('[data-preview-source-link]');
    if (sourceLink) {
      if (isSafeHttpUrl(sourceUrl)) sourceLink.href = sourceUrl;
      else sourceLink.removeAttribute('href');
      find<HTMLElement>('[data-source-github-icon]').hidden = !github;
      find<HTMLElement>('[data-source-link-icon]').hidden = github;
    }
    text('[data-preview-license]', current.license);
    const licenseLink = find<HTMLAnchorElement>('[data-preview-license]');
    if (licenseLink) {
      const href = licenseUrl(current.license);
      if (href) licenseLink.href = href;
      else licenseLink.removeAttribute('href');
      licenseLink.classList.toggle('underline', Boolean(href));
    }
    text('[data-preview-author]', current.author.name);
    const authorLink = find<HTMLAnchorElement>('[data-preview-author]');
    if (authorLink) {
      if (isSafeHttpUrl(current.author.url))
        authorLink.href = current.author.url ?? '';
      else authorLink.removeAttribute('href');
      authorLink.classList.toggle(
        'underline',
        isSafeHttpUrl(current.author.url),
      );
      find<HTMLElement>('[data-author-detail]').hidden = !current.author.name;
    }
    text(
      '[data-preview-requirements]',
      [
        `FOSSBilling ${current.requires.fossbilling}`,
        `PHP ${current.requires.php}`,
        ...Object.entries(current.requires.modules ?? {}).map(
          ([id, constraint]) => `${id}: ${constraint}`,
        ),
      ].join('\n'),
    );
    const requirementsDetail = find<HTMLElement>('[data-requirements-detail]');
    if (requirementsDetail) requirementsDetail.hidden = false;
    text('[data-release-count]', String(current.releases.length));
    const readme = find<HTMLElement>('[data-preview-readme]');
    if (readme) readme.innerHTML = renderMarkdown(current.readme);
    root
      .querySelectorAll<HTMLElement>('[data-section-changed]')
      .forEach((node) => {
        node.hidden = !(
          draft.sections[node.dataset.sectionChanged as DraftSection] ||
          (node.dataset.sectionChanged === 'listing' && draft.sections.details)
        );
      });
    renderReleases(current);
    updateButtons();
  }
  function fill(form: HTMLFormElement, values: Record<string, string>) {
    for (const [name, value] of Object.entries(values)) {
      const field = form.elements.namedItem(name);
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement ||
        field instanceof HTMLSelectElement
      )
        field.value = value;
    }
    customLicense(form);
  }
  function customLicense(form: HTMLFormElement) {
    const select = form.elements.namedItem('license_spdx_id');
    const wrapper = form.querySelector<HTMLElement>('[data-custom-license]');
    const input = form.elements.namedItem('license_name_custom');
    if (
      select instanceof HTMLSelectElement &&
      wrapper &&
      input instanceof HTMLInputElement
    ) {
      wrapper.hidden = select.value !== 'other';
      input.required = !wrapper.hidden;
    }
  }
  function setSectionEditing(
    form: HTMLFormElement,
    section: string,
    editing: boolean,
  ) {
    form.hidden = !editing;
    find<HTMLElement>(`[data-section-preview="${section}"]`).hidden = editing;
    const button = find<HTMLButtonElement>(`[data-edit-section="${section}"]`);
    button.setAttribute('aria-expanded', String(editing));
    button.querySelector<HTMLElement>('[data-edit-label]')!.textContent =
      editing ? 'Close' : 'Edit';
  }
  function closeSection(form: HTMLFormElement, section: string) {
    setSectionEditing(form, section, false);
    const button = find<HTMLButtonElement>(`[data-edit-section="${section}"]`);
    unsaved.delete(form);
    updateButtons();
    button.focus();
  }
  root
    .querySelectorAll<HTMLFormElement>('[data-section-form]')
    .forEach((form) => {
      const section = form.dataset.sectionForm as DraftSection;
      const initial = fields(form);
      const sectionError = form.querySelector<HTMLElement>(
        '[data-section-error]',
      )!;
      find<HTMLButtonElement>(
        `[data-edit-section="${section}"]`,
      ).addEventListener('click', () => {
        if (!form.hidden) {
          setSectionEditing(form, section, false);
          return;
        }
        if (!unsaved.has(form))
          fill(form, {
            ...initial,
            ...(section === 'listing' ? draft.sections.details : {}),
            ...draft.sections[section],
          });
        setSectionEditing(form, section, true);
        form.querySelector<HTMLElement>('input, textarea, select')?.focus();
      });
      form.addEventListener('input', () => {
        unsaved.add(form);
        customLicense(form);
        updateButtons();
      });
      form.addEventListener('change', () => {
        unsaved.add(form);
        customLicense(form);
        updateButtons();
      });
      find<HTMLButtonElement>(
        `[data-cancel-section="${section}"]`,
      ).addEventListener('click', () => {
        sectionError.hidden = true;
        closeSection(form, section);
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        try {
          const sections = { ...draft.sections, [section]: fields(form) };
          // The merged Listing form supersedes older Source & License drafts.
          if (section === 'listing') delete sections.details;
          save({ ...draft, sections });
          sectionError.hidden = true;
          closeSection(form, section);
          refresh();
        } catch (cause) {
          sectionError.textContent =
            cause instanceof Error
              ? cause.message
              : 'Unable to save this section.';
          sectionError.hidden = false;
        }
      });
    });

  const releaseForm = find<HTMLFormElement>('[data-release-form]');
  const releaseEditor = find<HTMLElement>('[data-release-editor]');
  function editRelease(tag?: string) {
    if (!releaseForm) return;
    if (
      unsaved.has(releaseForm) &&
      !confirm('Discard the unsaved release edits?')
    )
      return;
    releaseForm.reset();
    const current = content();
    const release = current.releases.find((item) => item.tag === tag);
    fill(releaseForm, {
      original_tag: tag ?? '',
      version_tag: release?.tag ?? '',
      release_date: release?.date.slice(0, 10) ?? '',
      download_url: release?.download_url ?? '',
      changelog_url: release?.changelog_url ?? '',
      requires_fossbilling: release?.requires.fossbilling ?? '',
      requires_php: release?.requires.php ?? '',
      requires_modules: Object.entries(release?.requires.modules ?? {})
        .map(([id, constraint]) => `${id}: ${constraint}`)
        .join('\n'),
    });
    find('[data-release-form-title]').textContent = tag
      ? 'Edit Release'
      : 'Add Release';
    find('[data-release-error]').hidden = true;
    releaseEditor.hidden = false;
    unsaved.delete(releaseForm);
    updateButtons();
    (releaseForm.elements.namedItem('version_tag') as HTMLInputElement).focus();
  }
  function renderReleases(current: ExtensionUpdate) {
    const list = find<HTMLUListElement>('[data-release-list]');
    if (!list) return;
    const emptyState = find<HTMLElement>('[data-release-empty]');
    if (emptyState) emptyState.hidden = current.releases.length > 0;
    list.replaceChildren();
    const latest = latestRelease(current.releases);
    for (const release of releasesDescending(current.releases)) {
      const li = document.createElement('li');
      li.className =
        'flex flex-wrap items-center justify-between gap-4 p-5 sm:px-6';
      const info = document.createElement('div');
      info.className = 'min-w-0 max-w-full';
      const title = document.createElement('p');
      title.className = 'text-sm font-semibold';
      title.textContent = `${release.tag}${release.tag === latest?.tag ? ' · Latest Version' : ''}`;
      const detail = document.createElement('p');
      detail.className = 'mt-1 text-xs text-muted-foreground';
      detail.textContent = `${release.date} · FOSSBilling ${release.requires.fossbilling} · PHP ${release.requires.php}`;
      const links = document.createElement('p');
      links.className = 'mt-2 max-w-xl text-xs text-muted-foreground';
      const download = document.createElement('a');
      download.className = 'break-all underline-offset-4';
      download.textContent = release.download_url;
      if (isSafeHttpUrl(release.download_url)) {
        download.href = release.download_url;
        download.target = '_blank';
        download.rel = 'noopener noreferrer';
        download.classList.add('underline');
      }
      info.appendChild(title);
      info.appendChild(detail);
      links.appendChild(download);
      if (release.changelog_url && isSafeHttpUrl(release.changelog_url)) {
        const changelog = document.createElement('a');
        changelog.className = 'underline underline-offset-4';
        changelog.textContent = 'Changelog';
        changelog.href = release.changelog_url;
        changelog.target = '_blank';
        changelog.rel = 'noopener noreferrer';
        changelog.setAttribute('aria-label', `Changelog for ${release.tag}`);
        const changelogGroup = document.createElement('span');
        changelogGroup.className = 'whitespace-nowrap';
        const separator = document.createElement('span');
        separator.setAttribute('aria-hidden', 'true');
        separator.textContent = ' | ';
        changelogGroup.appendChild(separator);
        changelogGroup.appendChild(changelog);
        links.appendChild(changelogGroup);
      }
      info.appendChild(links);
      const actions = document.createElement('div');
      actions.className = 'flex flex-wrap gap-2';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn';
      edit.dataset.variant = 'outline';
      edit.dataset.size = 'sm';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit Release ${release.tag}`);
      edit.addEventListener('click', () => editRelease(release.tag));
      actions.appendChild(edit);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn';
      remove.dataset.variant = 'destructive';
      remove.dataset.size = 'sm';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove Release ${release.tag}`);
      remove.disabled = current.releases.length === 1;
      if (remove.disabled) remove.title = 'Keep at least one release.';
      remove.addEventListener('click', () => {
        if (!confirm(`Remove Release ${release.tag} from this draft?`)) return;
        try {
          save({
            ...draft,
            releases: current.releases.filter(
              (item) => item.tag !== release.tag,
            ),
          });
          refresh();
        } catch (cause) {
          error(
            cause instanceof Error
              ? cause.message
              : 'Unable to remove this release.',
          );
        }
      });
      actions.appendChild(remove);
      li.appendChild(info);
      li.appendChild(actions);
      list.appendChild(li);
    }
  }
  find<HTMLButtonElement>('[data-add-release]')?.addEventListener('click', () =>
    editRelease(),
  );
  find<HTMLButtonElement>('[data-cancel-release]')?.addEventListener(
    'click',
    () => {
      releaseEditor.hidden = true;
      unsaved.delete(releaseForm);
      updateButtons();
    },
  );
  releaseForm?.addEventListener('input', () => {
    unsaved.add(releaseForm);
    updateButtons();
  });
  releaseForm?.addEventListener('change', () => {
    unsaved.add(releaseForm);
    updateButtons();
  });
  releaseForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const input = fields(releaseForm);
      const release = releaseFromFields(input);
      const current = content();
      if (
        current.releases.some(
          (item) => item.tag === release.tag && item.tag !== input.original_tag,
        )
      )
        throw new Error(`A release tagged "${release.tag}" already exists.`);
      const releases = input.original_tag
        ? current.releases.map((item) =>
            item.tag === input.original_tag ? release : item,
          )
        : [...current.releases, release];
      save({
        ...draft,
        releases,
      });
      releaseEditor.hidden = true;
      unsaved.delete(releaseForm);
      refresh();
    } catch (cause) {
      const node = find('[data-release-error]');
      node.textContent =
        cause instanceof Error ? cause.message : 'Unable to save release.';
      node.hidden = false;
    }
  });
  discard.addEventListener('click', () => {
    if (!confirm('Discard all local draft changes for this extension?')) return;
    try {
      localStorage.removeItem(config.key);
    } catch {
      error('The draft could not be removed from browser storage.');
      return;
    }
    unsaved.clear();
    stored = false;
    blocked = false;
    draft = empty();
    root
      .querySelectorAll<HTMLFormElement>('[data-section-form]')
      .forEach((form) => {
        setSectionEditing(form, form.dataset.sectionForm!, false);
      });
    if (releaseEditor) releaseEditor.hidden = true;
    error('');
    refresh();
  });
  submit.addEventListener('click', async () => {
    if (submit.disabled) return;
    busy = true;
    updateButtons();
    submit.textContent = 'Submitting…';
    root.inert = true;
    root.setAttribute('aria-busy', 'true');
    try {
      const body = new FormData();
      body.set('draft', JSON.stringify(draft));
      const response = await fetch(config.submitUrl, {
        method: 'POST',
        body,
        redirect: 'manual',
      });
      if (response.status === 0 || response.status === 302)
        throw new Error(
          'Your session has expired. Sign in again; your local draft has been kept.',
        );
      const result = (await response.json()) as {
        error?: string;
        url?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error ||
            'Unable to submit changes. Your local draft has been kept.',
        );
      try {
        localStorage.removeItem(config.key);
      } catch {
        /* A stale draft will be flagged on the next editable visit. */
      }
      stored = false;
      unsaved.clear();
      window.location.assign(result.url ?? config.baseUrl);
    } catch (cause) {
      error(
        cause instanceof Error
          ? cause.message
          : 'Unable to submit changes. Your local draft has been kept.',
      );
      busy = false;
      root.inert = false;
      root.removeAttribute('aria-busy');
      submit.textContent = config.submitLabel;
      updateButtons();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (unsaved.size) {
      event.preventDefault();
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === config.key || event.key === null) {
      blocked = true;
      error(
        'This draft changed in another tab. Reload before editing or submitting so those changes are not overwritten.',
      );
      updateButtons();
    }
  });
  refresh();
}
