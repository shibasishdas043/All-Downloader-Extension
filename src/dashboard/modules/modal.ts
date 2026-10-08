// ============================================================
//  All-Downloader — Dashboard Add Download Modal
// ============================================================
import { MSG } from '../../shared/constants.js';
import { isValidUrl } from '../../shared/utils.js';
import { sendMsg } from './api.js';
import { SnifferController } from '../../shared/sniffer-controller.js';

export function bindModal(): void {
  const $modal = document.getElementById('modal-add');
  if (!$modal) return;

  document.getElementById('modal-close')?.addEventListener('click', () => { $modal.hidden = true; });
  document.getElementById('dash-modal-cancel')?.addEventListener('click', () => { $modal.hidden = true; });
  $modal.addEventListener('click', (e) => { if (e.target === $modal) $modal.hidden = true; });

  // Page Sniffer in Dashboard
  const snifferModal = document.getElementById('modal-sniffer');
  if (snifferModal) {
    const snifferController = new SnifferController(
      {
        modal: snifferModal,
        pageTitle: document.getElementById('sniffer-page-title')!,
        loading: document.getElementById('sniffer-loading')!,
        empty: document.getElementById('sniffer-empty')!,
        list: document.getElementById('sniffer-list')!,
        filterInput: document.getElementById('sniffer-filter') as HTMLInputElement,
        selectAllCheckbox: document.getElementById('sniffer-select-all') as HTMLInputElement,
        selectedCountLabel: document.getElementById('sniffer-sel-count')!,
        downloadBtn: document.getElementById('btn-sniffer-download') as HTMLButtonElement,
        closeBtn: document.getElementById('sniffer-close')!,
        cntAll: document.getElementById('sniff-cnt-all')!,
        cntImage: document.getElementById('sniff-cnt-image')!,
        cntVideo: document.getElementById('sniff-cnt-video')!,
        cntAudio: document.getElementById('sniff-cnt-audio')!,
        cntDocument: document.getElementById('sniff-cnt-document')!,
        targetUrlInput: (document.getElementById('sniffer-target-url') as HTMLInputElement) || undefined,
        scanBtn: document.getElementById('sniffer-btn-scan') || undefined,
        tabsDatalist: (document.getElementById('sniffer-open-tabs') as HTMLDataListElement) || undefined,
      },
      async (items) => {
        for (const item of items) {
          await sendMsg({
            type: MSG.START_DOWNLOAD,
            payload: { url: item.url, filename: item.filename }
          });
        }
      }
    );

    document.getElementById('btn-page-sniffer')?.addEventListener('click', () => {
      snifferController.open();
    });
  }

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
