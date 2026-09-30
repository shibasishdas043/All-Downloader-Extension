// ============================================================
//  All-Downloader — Context Menu Management Service
// ============================================================
import { getFilenameFromUrl } from '../../shared/utils.js';
import { openDashboard } from './badge-manager.js';

export function setupContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'adl-download-link',
      title: 'Download with All Downloader',
      contexts: ['link', 'image', 'video', 'audio'],
    });
    chrome.contextMenus.create({
      id: 'adl-open-dashboard',
      title: 'Open All Downloader Dashboard',
      contexts: ['action'],
    });
  });
}

export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  onAddDownload: (opts: { url: string; filename?: string }) => Promise<any>
): Promise<void> {
  if (info.menuItemId === 'adl-download-link') {
    const url = info.linkUrl || info.srcUrl;
    if (url) await onAddDownload({ url, filename: getFilenameFromUrl(url) });
  }
  if (info.menuItemId === 'adl-open-dashboard') {
    openDashboard();
  }
}
