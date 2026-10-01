// ============================================================
//  All-Downloader — Popup User Actions
// ============================================================
import { MSG, DOWNLOAD_STATE, UI } from '../../shared/constants.js';
import { isValidUrl } from '../../shared/utils.js';
import { sendMsg } from './api.js';
import { downloads, getAllDownloads } from './state.js';
import { $urlInput, $filenameInput, hideModal, $list, $empty } from './dom.js';
import { updateItem, updateStatusBar } from './renderer.js';

export async function pauseDl(id: string): Promise<void> {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.PAUSED;
    downloads[id].status = DOWNLOAD_STATE.PAUSED;
    downloads[id].speed = 0;
    downloads[id].eta = null;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.PAUSE_DOWNLOAD, id });
}

export async function resumeDl(id: string): Promise<void> {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.CONNECTING;
    downloads[id].status = DOWNLOAD_STATE.CONNECTING;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.RESUME_DOWNLOAD, id });
}

export async function cancelDl(id: string): Promise<void> {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.CANCELLED;
    downloads[id].status = DOWNLOAD_STATE.CANCELLED;
    downloads[id].speed = 0;
    downloads[id].eta = null;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.CANCEL_DOWNLOAD, id });
}

export async function deleteDl(id: string): Promise<void> {
  delete downloads[id];
  $list.querySelector(`.dl-item[data-id="${id}"]`)?.remove();
  const remaining = getAllDownloads()
    .sort((a: any, b: any) => b.createdAt - a.createdAt)
    .slice(0, UI.POPUP_MAX_VISIBLE);
  $empty.style.display = remaining.length === 0 ? 'flex' : 'none';
  updateStatusBar();
  await sendMsg({ type: MSG.DELETE_DOWNLOAD, id });
}

export async function retryDl(id: string): Promise<void> {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.QUEUED;
    downloads[id].status = DOWNLOAD_STATE.QUEUED;
    downloads[id].error = null;
    downloads[id].errorMessage = null;
    downloads[id].percent = 0;
    downloads[id].progress = 0;
    downloads[id].received = 0;
    downloads[id].receivedBytes = 0;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.RETRY_DOWNLOAD, id });
}

export async function showInFolder(id: string): Promise<void> {
  await sendMsg({ type: MSG.SHOW_IN_FOLDER, id });
}

export async function pauseAll(): Promise<void> {
  const active = getAllDownloads().filter(d => (d.status || d.state) === DOWNLOAD_STATE.DOWNLOADING);
  for (const dl of active) await pauseDl(dl.id);
}

export async function startManualDownload(): Promise<void> {
  const url = $urlInput.value.trim();
  const wrapper = $urlInput.closest('.input-wrapper') as HTMLElement | null;
  if (!isValidUrl(url)) {
    if (wrapper) {
      wrapper.style.background = '#fee2e2';
      setTimeout(() => { wrapper.style.background = ''; }, 1200);
    }
    $urlInput.focus();
    return;
  }
  const filename = $filenameInput.value.trim() || undefined;
  hideModal();
  await sendMsg({ type: MSG.START_DOWNLOAD, payload: { url, filename } });
}

export async function openDashboard(view: string = 'settings'): Promise<void> {
  const baseUrl = chrome.runtime.getURL('src/dashboard/dashboard.html');
  const targetUrl = view ? `${baseUrl}?view=${encodeURIComponent(view)}` : baseUrl;

  if (chrome.tabs && chrome.tabs.create) {
    try {
      chrome.tabs.query({ url: `${baseUrl}*` }, (existingTabs) => {
        if (chrome.runtime.lastError) {
          chrome.tabs.create({ url: targetUrl }, () => window.close());
          return;
        }

        if (existingTabs && existingTabs.length > 0 && existingTabs[0]?.id) {
          chrome.tabs.update(existingTabs[0].id, { url: targetUrl, active: true }, () => {
            if (existingTabs[0]?.windowId) {
              chrome.windows?.update(existingTabs[0].windowId, { focused: true }, () => window.close());
            } else {
              window.close();
            }
          });
        } else {
          chrome.tabs.create({ url: targetUrl }, () => window.close());
        }
      });
      return;
    } catch (e) {
      console.warn('[Popup] Direct tabs API failed, falling back to message:', e);
    }
  }

  // Fallback to background service worker message
  await sendMsg({ type: MSG.OPEN_DASHBOARD, view });
  setTimeout(() => window.close(), 100);
}
