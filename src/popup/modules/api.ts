// ============================================================
//  All-Downloader — Popup Runtime Messaging Client
// ============================================================

export function sendMsg(msg: any): Promise<any> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        resolve({ ok: false, error: 'Extension runtime unavailable' });
        return;
      }
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime?.lastError) {
          console.warn('[ADL Popup] Runtime message warning:', chrome.runtime.lastError.message);
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(res !== undefined ? res : { ok: true });
        }
      });
    } catch (err: any) {
      console.warn('[ADL Popup] Send error:', err);
      resolve({ ok: false, error: err?.message || 'Failed to send message' });
    }
  });
}
