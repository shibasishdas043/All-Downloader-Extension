// ============================================================
//  All-Downloader — Storage Layer (TypeScript)
//  Wraps chrome.storage.local for download records + settings.
//  Uses a simple IndexedDB wrapper for large binary chunk caching.
// ============================================================
import { STORAGE_KEY, DEFAULT_SETTINGS } from '../shared/constants.js';
import type { DownloadItem, ExtensionSettings, ExtensionStats } from '../shared/types.js';

// ─────────────────────────────────────────────────────────────
//  chrome.storage helpers
// ─────────────────────────────────────────────────────────────

function storageGet(keys: string[]): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    });
  });
}

function storageSet(data: Record<string, any>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

// ─────────────────────────────────────────────────────────────
//  Downloads CRUD
// ─────────────────────────────────────────────────────────────

/** Load all download records from storage. */
export async function loadDownloads(): Promise<Record<string, DownloadItem>> {
  const result = await storageGet([STORAGE_KEY.DOWNLOADS]);
  return result[STORAGE_KEY.DOWNLOADS] || {};
}

/** Save the full downloads map to storage. */
export async function saveDownloads(downloadsMap: Record<string, DownloadItem>): Promise<void> {
  await storageSet({ [STORAGE_KEY.DOWNLOADS]: downloadsMap });
}

/** Insert or update a single download record. */
export async function upsertDownload(download: DownloadItem): Promise<DownloadItem> {
  const all = await loadDownloads();
  all[download.id] = download;
  await saveDownloads(all);
  return download;
}

/** Get a single download by ID. */
export async function getDownload(id: string): Promise<DownloadItem | null> {
  const all = await loadDownloads();
  return all[id] || null;
}

/** Delete a download record. */
export async function deleteDownload(id: string): Promise<void> {
  const all = await loadDownloads();
  delete all[id];
  await saveDownloads(all);
}

/** Clear all completed / cancelled download history. */
export async function clearHistory(): Promise<void> {
  const all = await loadDownloads();
  const active: Record<string, DownloadItem> = {};
  for (const [id, dl] of Object.entries(all)) {
    const st = dl.status || (dl as any).state;
    if (['downloading', 'queued', 'paused', 'connecting'].includes(st)) {
      active[id] = dl;
    }
  }
  await saveDownloads(active);
}

// ─────────────────────────────────────────────────────────────
//  Settings CRUD
// ─────────────────────────────────────────────────────────────

/** Load settings, merged with defaults. */
export async function loadSettings(): Promise<ExtensionSettings> {
  const result = await storageGet([STORAGE_KEY.SETTINGS]);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY.SETTINGS] || {}) } as ExtensionSettings;
}

/** Save partial or full settings object. */
export async function saveSettings(partial: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const merged = { ...current, ...partial };
  await storageSet({ [STORAGE_KEY.SETTINGS]: merged });
  return merged;
}

// ─────────────────────────────────────────────────────────────
//  Stats
// ─────────────────────────────────────────────────────────────

/** Load lifetime stats. */
export async function loadStats(): Promise<ExtensionStats & { totalDownloaded?: number; totalFiles?: number; totalTime?: number; sessionsCount?: number }> {
  const result = await storageGet([STORAGE_KEY.STATS]);
  return result[STORAGE_KEY.STATS] || {
    totalDownloadedBytes: 0,
    totalCompletedFiles:  0,
    totalFailedFiles:     0,
    totalDownloaded:      0,
    totalFiles:           0,
    totalTime:            0,
    sessionsCount:        0,
  };
}

/** Increment stats after a completed download. */
export async function recordCompletion(bytes: number, durationMs: number): Promise<void> {
  const stats = await loadStats();
  stats.totalDownloadedBytes = (stats.totalDownloadedBytes || 0) + bytes;
  stats.totalCompletedFiles  = (stats.totalCompletedFiles || 0) + 1;
  (stats as any).totalDownloaded = ((stats as any).totalDownloaded || 0) + bytes;
  (stats as any).totalFiles      = ((stats as any).totalFiles || 0) + 1;
  (stats as any).totalTime       = ((stats as any).totalTime || 0) + durationMs;
  await storageSet({ [STORAGE_KEY.STATS]: stats });
}

// ─────────────────────────────────────────────────────────────
//  IndexedDB — Chunk Cache (for pause/resume byte ranges)
// ─────────────────────────────────────────────────────────────

const IDB_NAME    = 'AllDownloaderChunks';
const IDB_VERSION = 1;
const IDB_STORE   = 'chunks';

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;
      db.createObjectStore(IDB_STORE, { keyPath: 'key' });
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror   = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

/** Save a chunk buffer for a given downloadId + chunkIndex. */
export async function saveChunk(downloadId: string, chunkIndex: number, buffer: ArrayBuffer | Blob): Promise<void> {
  const db  = await openIDB();
  const key = `${downloadId}_${chunkIndex}`;
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req   = store.put({ key, buffer });
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject((e.target as IDBRequest).error);
  });
}

/** Load a chunk buffer. */
export async function loadChunk(downloadId: string, chunkIndex: number): Promise<ArrayBuffer | null> {
  const db  = await openIDB();
  const key = `${downloadId}_${chunkIndex}`;
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req   = store.get(key);
    req.onsuccess = (e) => resolve((e.target as IDBRequest).result?.buffer || null);
    req.onerror   = (e) => reject((e.target as IDBRequest).error);
  });
}

/** Delete all chunks for a download (after merge or cancel). */
export async function clearChunks(downloadId: string): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req   = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        if (typeof cursor.key === 'string' && cursor.key.startsWith(`${downloadId}_`)) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}
