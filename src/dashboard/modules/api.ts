// ============================================================
//  All-Downloader — Dashboard Runtime Messaging Client
// ============================================================

export function sendMsg(msg: any): Promise<any> {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}
