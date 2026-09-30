// ============================================================
//  All-Downloader — Popup State Store
// ============================================================

export const downloads: Record<string, any> = {};

export function getDownload(id: string): any {
  return downloads[id];
}

export function setDownload(id: string, dl: any): void {
  downloads[id] = dl;
}

export function removeDownload(id: string): void {
  delete downloads[id];
}

export function getAllDownloads(): any[] {
  return Object.values(downloads);
}
