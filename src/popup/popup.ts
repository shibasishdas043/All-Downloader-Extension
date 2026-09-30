// ============================================================
//  All-Downloader — Popup Entry Point
// ============================================================
import { MSG } from '../shared/constants.js';
import {
  bindEvents,
  handleSWMessage,
  renderAll,
  sendMsg,
  setDownload,
} from './modules/index.js';

async function init(): Promise<void> {
  bindEvents();

  chrome.runtime.onMessage.addListener(handleSWMessage);

  try {
    const res = await sendMsg({ type: MSG.GET_DOWNLOADS });
    if (res?.downloads) {
      for (const dl of res.downloads) setDownload(dl.id, dl);
    }
  } catch (err) {
    console.warn('[Popup] Failed to load initial downloads:', err);
  }
  renderAll();
}

init().catch(console.error);
