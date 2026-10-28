// ============================================================
//  All-Downloader — Popup Entry Point (Dynamic Status View)
// ============================================================
import { MSG } from '../shared/constants.js';
import {
  bindEvents,
  handleSWMessage,
  renderAll,
  sendMsg,
  setDownload,
  getAllDownloads,
} from './modules/index.js';

async function init(): Promise<void> {
  bindEvents();

  chrome.runtime.onMessage.addListener(handleSWMessage);

  try {
    const res = await sendMsg({ type: MSG.GET_DOWNLOADS });
    if (res?.downloads) {
      for (const dl of res.downloads) setDownload(dl.id, dl);
    }

    if (typeof chrome !== 'undefined' && chrome.downloads?.search) {
      chrome.downloads.search({ limit: 50, orderBy: ['-startTime'] }, (items) => {
        if (!items) return;
        const all = getAllDownloads();
        for (const dl of all) {
          if (!dl.chromeDownloadId) {
            const filename = dl.filename || dl.savePath || '';
            const safeBase = filename.split(/[\\/]/).pop() || filename;
            const match = items.find(it => (it.filename && it.filename.endsWith(safeBase)) || (it.url && it.url === dl.url));
            if (match) dl.chromeDownloadId = match.id;
          }
        }
      });
    }
  } catch (err) {
    console.warn('[Popup] Failed to load initial downloads:', err);
  }
  renderAll();
}

init().catch(console.error);
