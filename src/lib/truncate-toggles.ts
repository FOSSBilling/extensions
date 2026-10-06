// Shared Show More/Less delegation for the [data-truncate-toggle] buttons
// rendered by TruncatedText.astro (and by the browser queue renderer's
// valueCell, which emits the same data attributes). Pages install this once;
// every table using the component gets a working toggle.
import {
  TRUNCATE_COLLAPSE_LABEL,
  TRUNCATE_EXPAND_LABEL,
} from './revision-diff-shared';

export function initTruncateToggles(): void {
  document.addEventListener('click', (event: MouseEvent) => {
    const toggle = (
      event.target as HTMLElement | null
    )?.closest<HTMLButtonElement>('[data-truncate-toggle]');
    if (!toggle) return;

    const cell = toggle.closest('td');
    const short = cell?.querySelector<HTMLElement>('[data-truncate-short]');
    const full = cell?.querySelector<HTMLElement>('[data-truncate-full]');
    if (!short || !full) return;
    const expanded = full.hidden;
    full.hidden = !expanded;
    short.hidden = expanded;
    toggle.textContent = expanded
      ? TRUNCATE_COLLAPSE_LABEL
      : TRUNCATE_EXPAND_LABEL;
    toggle.setAttribute('aria-expanded', String(expanded));
  });
}
