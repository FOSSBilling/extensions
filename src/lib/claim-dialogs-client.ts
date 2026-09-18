// Wiring for ClaimCard approve/reject buttons. Each button names its dialog
// via data-claim-dialog and a single delegated listener opens it — claim ids
// travel on data attributes, never inside inline executable handlers (an
// interpolated id would survive HTML-escaping and break out after the
// browser decodes entities before compiling the handler).
export function initClaimDialogs(): void {
  document.addEventListener('click', (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>('[data-claim-dialog]');
    if (!button) return;
    const dialog = document.getElementById(button.dataset.claimDialog ?? '');
    if (dialog instanceof HTMLDialogElement) dialog.showModal();
  });
}
