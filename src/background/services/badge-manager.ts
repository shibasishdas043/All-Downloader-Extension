// ============================================================
//  All-Downloader — Badge, Dashboard & Notification Service
// ============================================================
import { DOWNLOAD_STATE } from '../../shared/constants.js';
import type { DownloadItem, DownloadState } from '../../shared/types.js';

export function updateBadge(downloads: Iterable<DownloadItem>): void {
  const ACTIVE_STATES: DownloadState[] = [
    DOWNLOAD_STATE.QUEUED,
    DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.DOWNLOADING,
    DOWNLOAD_STATE.PAUSED,
    DOWNLOAD_STATE.MERGING,
    DOWNLOAD_STATE.VERIFYING,
  ] as DownloadState[];

  const activeCount = [...downloads].filter(
    (dl: any) => ACTIVE_STATES.includes(dl.status || dl.state)
  ).length;

  if (activeCount > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#219ebc' });
    chrome.action.setBadgeText({ text: String(activeCount) });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

export function broadcastMessage(payload: Record<string, any>): void {
  try {
    const p = chrome.runtime?.sendMessage(payload);
    if (p && typeof (p as any).catch === 'function') {
      (p as any).catch(() => {});
    }
  } catch {
    // Ignore when popup/dashboard is closed
  }
}

export function openDashboard(view?: string): void {
  const baseUrl = chrome.runtime.getURL('src/dashboard/dashboard.html');
  const targetUrl = view ? `${baseUrl}?view=${encodeURIComponent(view)}` : baseUrl;
  chrome.tabs.query({ url: `${baseUrl}*` }, (tabs) => {
    if (tabs && tabs.length > 0 && tabs[0]?.id) {
      chrome.tabs.update(tabs[0].id, { url: targetUrl, active: true });
      if (tabs[0].windowId) {
        chrome.windows?.update(tabs[0].windowId, { focused: true });
      }
    } else {
      chrome.tabs.create({ url: targetUrl });
    }
  });
}

export function showNotification(title: string, message: string): void {
  try {
    if (typeof chrome === 'undefined' || !chrome.notifications?.create) return;
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime?.getURL ? chrome.runtime.getURL('src/assets/icons/icon48.png') : '',
      title,
      message,
    });
  } catch {
    // Ignore notification errors in test or headless environments
  }
}
