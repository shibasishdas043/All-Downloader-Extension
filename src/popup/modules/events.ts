// ============================================================
//  All-Downloader — Popup Event Listeners & SW Message Handlers
// ============================================================
import { MSG, DOWNLOAD_STATE } from '../../shared/constants.js';
import { $list, $modalAdd, $urlInput, showModal, hideModal } from './dom.js';
import { downloads, setDownload } from './state.js';
import {
  pauseDl, resumeDl, cancelDl, deleteDl,
  showInFolder, retryDl, pauseAll,
  startManualDownload, openDashboard
} from './actions.js';
import { renderAll, updateItem, updateStatusBar } from './renderer.js';

export function bindEvents(): void {
  $list.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest('.ctrl-btn');
    if (!btn) return;
    const item = btn.closest('.dl-item') as HTMLElement | null;
    if (!item) return;
    const id = item.dataset.id;
    if (!id) return;

    if (btn.classList.contains('ctrl-pause'))  pauseDl(id);
    if (btn.classList.contains('ctrl-resume')) resumeDl(id);
    if (btn.classList.contains('ctrl-cancel')) cancelDl(id);
    if (btn.classList.contains('ctrl-remove')) deleteDl(id);
    if (btn.classList.contains('ctrl-folder')) showInFolder(id);
    if (btn.classList.contains('ctrl-retry'))  retryDl(id);
  });

  document.getElementById('btn-dashboard')?.addEventListener('click', (e) => {
    e.preventDefault();
    openDashboard('settings');
  });
  document.getElementById('btn-view-all')?.addEventListener('click', (e) => {
    e.preventDefault();
    openDashboard('downloads');
  });
  document.getElementById('btn-add')?.addEventListener('click', showModal);
  document.getElementById('modal-close')?.addEventListener('click', hideModal);
  document.getElementById('btn-start-download')?.addEventListener('click', startManualDownload);
  document.getElementById('btn-pause-all')?.addEventListener('click', pauseAll);

  $modalAdd?.addEventListener('click', (e: MouseEvent) => {
    if (e.target === $modalAdd) hideModal();
  });

  $urlInput?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') startManualDownload();
  });
}

export function handleSWMessage(msg: any): void {
  switch (msg?.type) {
    case MSG.DOWNLOAD_ADDED:
      setDownload(msg.download.id, msg.download);
      renderAll();
      break;

    case MSG.DOWNLOAD_PROGRESS:
      if (downloads[msg.id]) {
        const curState = downloads[msg.id].state || downloads[msg.id].status;
        if ([DOWNLOAD_STATE.CANCELLED, DOWNLOAD_STATE.COMPLETED, DOWNLOAD_STATE.PAUSED].includes(curState)) {
          return;
        }
        const nextState = (msg.state === DOWNLOAD_STATE.MERGING)
          ? DOWNLOAD_STATE.MERGING
          : DOWNLOAD_STATE.DOWNLOADING;
        Object.assign(downloads[msg.id], {
          state:         nextState,
          status:        nextState,
          received:      msg.received,
          receivedBytes: msg.received,
          total:         msg.total,
          filesize:      msg.total,
          percent:       msg.percent,
          progress:      msg.percent,
          speed:         msg.speed,
          eta:           msg.eta,
        });
        updateItem(msg.id);
        updateStatusBar();
      }
      break;

    case MSG.DOWNLOAD_COMPLETED:
    case MSG.DOWNLOAD_PAUSED:
    case MSG.DOWNLOAD_CANCELLED:
    case MSG.DOWNLOAD_ERROR:
      if (downloads[msg.id]) {
        if (msg.type === MSG.DOWNLOAD_COMPLETED) {
          downloads[msg.id].state = DOWNLOAD_STATE.COMPLETED;
          downloads[msg.id].status = DOWNLOAD_STATE.COMPLETED;
        }
        if (msg.type === MSG.DOWNLOAD_PAUSED) {
          downloads[msg.id].state = DOWNLOAD_STATE.PAUSED;
          downloads[msg.id].status = DOWNLOAD_STATE.PAUSED;
        }
        if (msg.type === MSG.DOWNLOAD_CANCELLED) {
          downloads[msg.id].state = DOWNLOAD_STATE.CANCELLED;
          downloads[msg.id].status = DOWNLOAD_STATE.CANCELLED;
        }
        if (msg.type === MSG.DOWNLOAD_ERROR) {
          downloads[msg.id].state = DOWNLOAD_STATE.ERROR;
          downloads[msg.id].status = DOWNLOAD_STATE.ERROR;
          downloads[msg.id].error = msg.error;
          downloads[msg.id].errorMessage = msg.error;
        }
        updateItem(msg.id);
        updateStatusBar();
      }
      break;
  }
}
