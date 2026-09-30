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
  chrome.runtime.sendMessage(payload).catch(() => {});
}

export function openDashboard(): void {
  const url = chrome.runtime.getURL('src/dashboard/dashboard.html');
  chrome.tabs.query({ url }, (tabs) => {
    if (tabs && tabs.length > 0 && tabs[0]?.id) {
      chrome.tabs.update(tabs[0].id, { active: true });
      if (tabs[0].windowId) {
        chrome.windows?.update(tabs[0].windowId, { focused: true });
      }
    } else {
      chrome.tabs.create({ url });
    }
  });
}

export function showNotification(title: string, message: string): void {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('src/assets/icons/icon48.png'),
    title,
    message,
  });
}
