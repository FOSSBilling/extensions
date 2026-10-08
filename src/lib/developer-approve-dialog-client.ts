// Shared wiring for the single developer-approve dialog used by both admin
// surfaces (/account/admin and /account/admin/developers). Each row button
// carries its developer on data attributes (same pattern as the delist
// confirm on /account/admin/extensions); the dialog's action, title, and
// expected_revision/expected_generation inputs are filled in before showModal().
export function initDeveloperApproveDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>(
    '#admin-approve-developer',
  );

  document.addEventListener('click', (event) => {
    const button = (
      event.target as HTMLElement | null
    )?.closest<HTMLButtonElement>('button[data-approve-developer]');
    if (!button || !dialog) return;

    const id = button.dataset.developerId ?? '';
    const form = dialog.querySelector('form');
    const titleEl = dialog.querySelector('h2');
    const revisionInput = dialog.querySelector<HTMLInputElement>(
      'input[name="expected_revision"]',
    );
    const generationInput = dialog.querySelector<HTMLInputElement>(
      'input[name="expected_generation"]',
    );
    if (form) form.action = `/account/admin/developers/${id}/approve`;
    if (titleEl) {
      titleEl.textContent = `Approve "${button.dataset.developerName ?? id}"?`;
    }
    if (revisionInput) {
      revisionInput.value = button.dataset.expectedRevision ?? '';
    }
    if (generationInput) {
      generationInput.value = button.dataset.expectedGeneration ?? '';
    }
    dialog.showModal();
  });
}
