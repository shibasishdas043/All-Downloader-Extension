// ============================================================
//  All-Downloader — Popup Event Listeners & SW Message Handlers
// ============================================================
import { MSG, DOWNLOAD_STATE, UI } from '../../shared/constants.js';
import { $list, $empty, $modalAdd, $urlInput, showModal, hideModal } from './dom.js';
import { downloads, setDownload, getAllDownloads } from './state.js';
import {
  pauseDl, resumeDl, cancelDl, deleteDl,
  showInFolder, retryDl, pauseAll,
  startManualDownload, openDashboard, saveDlToDisk
} from './actions.js';
import { renderAll, updateItem, updateStatusBar, togglePopupChunkDrawer } from './renderer.js';

export function bindEvents(): void {
  $list.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;

    // 1. Control button click
    const btn = target?.closest('.ctrl-btn');
    if (btn) {
      const item = btn.closest('.dl-item') as HTMLElement | null;
      if (!item) return;
      const id = item.dataset.id;
      if (!id) return;

      if (btn.classList.contains('ctrl-save-disk')) saveDlToDisk(id);
      if (btn.classList.contains('ctrl-pause'))  pauseDl(id);
      if (btn.classList.contains('ctrl-resume')) resumeDl(id);
      if (btn.classList.contains('ctrl-cancel')) cancelDl(id);
      if (btn.classList.contains('ctrl-remove')) deleteDl(id);
      if (btn.classList.contains('ctrl-folder')) showInFolder(id);
      if (btn.classList.contains('ctrl-retry'))  retryDl(id);
      return;
    }

    // 2. Ignore clicks inside the drawer interactive area or on links
    if (target?.closest('.popup-chip') || target?.closest('a')) {
      return;
    }

    // 3. Item click: toggle parallel chunks drawer!
    const item = target?.closest('.dl-item') as HTMLElement | null;
    if (item && item.dataset.id) {
      togglePopupChunkDrawer(item.dataset.id);
    }
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

    case MSG.DOWNLOAD_RESUMED:
      if (downloads[msg.id]) {
        if (msg.download) {
          Object.assign(downloads[msg.id], msg.download);
        }
        if (downloads[msg.id].state !== DOWNLOAD_STATE.QUEUED) {
          downloads[msg.id].state = DOWNLOAD_STATE.CONNECTING;
          downloads[msg.id].status = DOWNLOAD_STATE.CONNECTING;
        }
        downloads[msg.id].error = null;
        downloads[msg.id].errorMessage = null;
        updateItem(msg.id);
        updateStatusBar();
      }
      break;

    case MSG.DOWNLOAD_AUTO_RETRY:
      if (downloads[msg.id]) {
        (downloads[msg.id] as any).autoReconnecting = true;
        downloads[msg.id].errorMessage = msg.errorMessage || `Connection lost — reconnecting (${msg.attempt}/5)…`;
        updateItem(msg.id);
        updateStatusBar();
      }
      break;

    case MSG.DOWNLOAD_PROGRESS:
      if (downloads[msg.id]) {
        (downloads[msg.id] as any).autoReconnecting = false;
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
          ...(msg.segments ? { segments: msg.segments } : {}),
          ...(msg.totalChunks ? { totalChunks: msg.totalChunks } : {}),
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
        if (msg.isReadyToSave !== undefined) {
          downloads[msg.id].isReadyToSave = msg.isReadyToSave;
        }
        if (msg.download) {
          Object.assign(downloads[msg.id], msg.download);
        }
        if (msg.type === MSG.DOWNLOAD_COMPLETED) {
          downloads[msg.id].state = DOWNLOAD_STATE.COMPLETED;
          downloads[msg.id].status = DOWNLOAD_STATE.COMPLETED;
          downloads[msg.id].isReadyToSave = false;
          const sz = msg.total || msg.filesize || msg.received || msg.receivedBytes;
          if (sz) {
            downloads[msg.id].total = sz;
            downloads[msg.id].filesize = sz;
            downloads[msg.id].received = sz;
            downloads[msg.id].receivedBytes = sz;
          }
          if (msg.filename) {
            downloads[msg.id].filename = msg.filename;
          }
        }
        if (msg.type === MSG.DOWNLOAD_PAUSED) {
          downloads[msg.id].state = DOWNLOAD_STATE.PAUSED;
          downloads[msg.id].status = DOWNLOAD_STATE.PAUSED;
          if (msg.isReadyToSave) {
            downloads[msg.id].percent = 100;
            downloads[msg.id].progress = 100;
          }
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

    case MSG.DOWNLOAD_DELETED:
      if (downloads[msg.id]) {
        delete downloads[msg.id];
        $list.querySelector(`.dl-item[data-id="${msg.id}"]`)?.remove();
        const remaining = getAllDownloads()
          .sort((a: any, b: any) => b.createdAt - a.createdAt)
          .slice(0, UI.POPUP_MAX_VISIBLE);
        if ($empty) $empty.style.display = remaining.length === 0 ? 'flex' : 'none';
        updateStatusBar();
      }
      break;

    case MSG.CLEAR_HISTORY:
      for (const id of Object.keys(downloads)) {
        const dl = downloads[id];
        const st = dl.status || dl.state;
        if (![
          DOWNLOAD_STATE.DOWNLOADING,
          DOWNLOAD_STATE.QUEUED,
          DOWNLOAD_STATE.CONNECTING,
          DOWNLOAD_STATE.PAUSED,
          DOWNLOAD_STATE.MERGING,
          DOWNLOAD_STATE.VERIFYING
        ].includes(st as any)) {
          delete downloads[id];
          $list.querySelector(`.dl-item[data-id="${id}"]`)?.remove();
        }
      }
      renderAll();
      updateStatusBar();
      break;
  }
}
