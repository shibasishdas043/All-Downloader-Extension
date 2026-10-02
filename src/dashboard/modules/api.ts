// ============================================================
//  All-Downloader — Dashboard Runtime Messaging Client
// ============================================================

export function sendMsg(msg: any): Promise<any> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        resolve({ ok: false, error: 'Extension runtime unavailable' });
        return;
      }
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime?.lastError) {
          console.warn('[ADL Dashboard] Runtime message warning:', chrome.runtime.lastError.message);
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response !== undefined ? response : { ok: true });
        }
      });
    } catch (err: any) {
      console.warn('[ADL Dashboard] Message send exception:', err);
      resolve({ ok: false, error: err?.message || 'Failed to send message' });
    }
  });
}
