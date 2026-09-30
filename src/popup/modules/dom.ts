// ============================================================
//  All-Downloader — Popup DOM References & Modal Controls
// ============================================================

export const $list = document.getElementById('download-list') as HTMLElement;
export const $empty = document.getElementById('empty-state') as HTMLElement;
export const $statusActive = document.getElementById('status-active') as HTMLElement;
export const $statusSpeed = document.getElementById('status-speed') as HTMLElement;
export const $statusQueue = document.getElementById('status-queue') as HTMLElement;
export const $modalAdd = document.getElementById('modal-add') as HTMLElement;
export const $urlInput = document.getElementById('url-input') as HTMLInputElement;
export const $filenameInput = document.getElementById('filename-input') as HTMLInputElement;
export const $tmpl = document.getElementById('tmpl-download-item') as HTMLTemplateElement;

export function showModal(): void {
  if ($modalAdd) $modalAdd.hidden = false;
  setTimeout(() => $urlInput?.focus(), 50);
}

export function hideModal(): void {
  if ($modalAdd) $modalAdd.hidden = true;
  if ($urlInput) $urlInput.value = '';
  if ($filenameInput) $filenameInput.value = '';
}
