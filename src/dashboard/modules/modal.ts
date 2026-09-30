// ============================================================
//  All-Downloader — Dashboard Add Download Modal
// ============================================================
import { MSG } from '../../shared/constants.js';
import { isValidUrl } from '../../shared/utils.js';
import { sendMsg } from './api.js';

export function bindModal(): void {
  const $modal = document.getElementById('modal-add');
  if (!$modal) return;

  document.getElementById('modal-close')?.addEventListener('click', () => { $modal.hidden = true; });
  document.getElementById('dash-modal-cancel')?.addEventListener('click', () => { $modal.hidden = true; });
  $modal.addEventListener('click', (e) => { if (e.target === $modal) $modal.hidden = true; });

  document.getElementById('dash-btn-start')?.addEventListener('click', async () => {
    const urlInput = document.getElementById('dash-url-input') as HTMLInputElement | null;
    const url = urlInput?.value.trim() || '';
    const fnInput = document.getElementById('dash-filename-input') as HTMLInputElement | null;
    const filename = fnInput?.value.trim() || undefined;
    const scInput = document.getElementById('dash-schedule-input') as HTMLInputElement | null;
    const sched = scInput?.value;

    if (!isValidUrl(url)) {
      if (urlInput) {
        urlInput.style.background = 'rgba(255, 0, 0, 0.08)';
        urlInput.focus();
        setTimeout(() => { urlInput.style.background = ''; }, 1500);
      }
      return;
    }

    const scheduledAt = sched ? new Date(sched).getTime() : null;
    await sendMsg({ type: MSG.START_DOWNLOAD, payload: { url, filename, scheduledAt } });

    $modal.hidden = true;
    if (urlInput) urlInput.value = '';
    if (fnInput) fnInput.value = '';
    if (scInput) scInput.value = '';
  });
}
