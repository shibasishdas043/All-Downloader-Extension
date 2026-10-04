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
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) {
      resolve({});
      return;
    }
    let called = false;
    const res: any = (chrome.storage.local.get as any)(keys, (result: any) => {
      if (called) return;
      called = true;
      if (chrome.runtime?.lastError) reject(chrome.runtime.lastError);
      else resolve(result || {});
    });
    if (res && typeof res.then === 'function') {
      res.then((val: any) => {
        if (!called) {
          called = true;
          resolve(val || {});
        }
      }).catch((err: any) => {
        if (!called) {
          called = true;
          reject(err);
        }
      });
    }
  });
}

function storageSet(data: Record<string, any>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) {
      resolve();
      return;
    }
    let called = false;
    const res: any = (chrome.storage.local.set as any)(data, () => {
      if (called) return;
      called = true;
      if (chrome.runtime?.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
    if (res && typeof res.then === 'function') {
      res.then(() => {
        if (!called) {
          called = true;
          resolve();
        }
      }).catch((err: any) => {
        if (!called) {
          called = true;
          reject(err);
        }
      });
    }
  });
}

// ─────────────────────────────────────────────────────────────
//  Downloads CRUD with Atomic Write Mutex & In-Memory Cache
// ─────────────────────────────────────────────────────────────

let inMemoryDownloads: Record<string, DownloadItem> | null = null;
let saveDownloadsPromise: Promise<void> = Promise.resolve();
let pendingSaveTimer: any = null;
const STORAGE_DEBOUNCE_MS = 250;

/** Load all download records from storage. */
export async function loadDownloads(): Promise<Record<string, DownloadItem>> {
  if (inMemoryDownloads) {
    return { ...inMemoryDownloads };
  }
  const result = await storageGet([STORAGE_KEY.DOWNLOADS]);
  inMemoryDownloads = result[STORAGE_KEY.DOWNLOADS] || {};
  return { ...inMemoryDownloads };
}

/** Internal atomic flush to chrome.storage.local */
async function flushDownloadsToStorage(): Promise<void> {
  if (!inMemoryDownloads) return;
  saveDownloadsPromise = saveDownloadsPromise
    .then(async () => {
      if (!inMemoryDownloads) return;
      const snapshot = { ...inMemoryDownloads };
      await storageSet({ [STORAGE_KEY.DOWNLOADS]: snapshot });
    })
    .catch((err) => console.error('[ADL Storage] Error writing downloads to storage:', err));
  await saveDownloadsPromise;
}

/** Save the full downloads map to storage. */
export async function saveDownloads(downloadsMap: Record<string, DownloadItem>): Promise<void> {
  inMemoryDownloads = { ...downloadsMap };
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  await flushDownloadsToStorage();
}

/** Insert or update a single download record with atomic synchronization. */
export async function upsertDownload(download: DownloadItem): Promise<DownloadItem> {
  if (!inMemoryDownloads) {
    await loadDownloads();
  }
  if (!inMemoryDownloads) {
    inMemoryDownloads = {};
  }
  inMemoryDownloads[download.id] = download;

  // Immediate disk flush for terminal or milestone states
  const immediateStates = ['completed', 'paused', 'error', 'cancelled', 'merging'];
  const isImmediate = immediateStates.includes(download.status) || immediateStates.includes((download as any).state);

  if (isImmediate) {
    if (pendingSaveTimer) {
      clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
    await flushDownloadsToStorage();
  } else {
    // Debounce high-frequency progress writes to prevent I/O thrashing and clobbering
    if (!pendingSaveTimer) {
      pendingSaveTimer = setTimeout(() => {
        pendingSaveTimer = null;
        flushDownloadsToStorage().catch(console.error);
      }, STORAGE_DEBOUNCE_MS);
    }
  }

  return download;
}

/** Get a single download by ID. */
export async function getDownload(id: string): Promise<DownloadItem | null> {
  if (inMemoryDownloads && inMemoryDownloads[id]) {
    return inMemoryDownloads[id];
  }
  const all = await loadDownloads();
  return all[id] || null;
}

/** Delete a download record. */
export async function deleteDownload(id: string): Promise<void> {
  if (!inMemoryDownloads) {
    await loadDownloads();
  }
  if (inMemoryDownloads) {
    delete inMemoryDownloads[id];
  }
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  await flushDownloadsToStorage();
}

/** Clear all completed / cancelled download history and reset stats. */
export async function clearHistory(): Promise<void> {
  const all = await loadDownloads();
  const active: Record<string, DownloadItem> = {};
  for (const [id, dl] of Object.entries(all)) {
    const st = dl.status || (dl as any).state;
    if (['downloading', 'queued', 'paused', 'connecting', 'merging', 'verifying'].includes(st)) {
      active[id] = dl;
    }
  }
  await saveDownloads(active);
  await resetStats();
}

/** Reset all lifetime stats to zero. */
export async function resetStats(): Promise<void> {
  const emptyStats = {
    totalDownloadedBytes: 0,
    totalCompletedFiles:  0,
    totalFailedFiles:     0,
    totalDownloaded:      0,
    totalFiles:           0,
    totalTime:            0,
    sessionsCount:        0,
  };
  await storageSet({ [STORAGE_KEY.STATS]: emptyStats });
}

// ─────────────────────────────────────────────────────────────
//  Settings CRUD
// ─────────────────────────────────────────────────────────────

let saveSettingsPromise: Promise<void> = Promise.resolve();

/** Load settings, merged with defaults. */
export async function loadSettings(): Promise<ExtensionSettings> {
  const result = await storageGet([STORAGE_KEY.SETTINGS]);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY.SETTINGS] || {}) } as ExtensionSettings;
}

/** Save partial or full settings object with atomic mutex serialization. */
export async function saveSettings(partial: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  let merged: ExtensionSettings = { ...DEFAULT_SETTINGS };
  saveSettingsPromise = saveSettingsPromise
    .then(async () => {
      const current = await loadSettings();
      merged = { ...current, ...partial };
      await storageSet({ [STORAGE_KEY.SETTINGS]: merged });
    })
    .catch((err) => console.error('[ADL Storage] Error writing settings to storage:', err));
  await saveSettingsPromise;
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
//  IndexedDB V2 — Persistent Chunk Storage & Secondary Indexing
// ─────────────────────────────────────────────────────────────

const IDB_NAME    = 'AllDownloaderChunks';
const IDB_VERSION = 2; // Upgraded for 'by_download' index
const IDB_STORE   = 'chunks';

let cachedDbPromise: Promise<IDBDatabase | null> | null = null;

function openIDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (cachedDbPromise) {
    return cachedDbPromise;
  }

  cachedDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        store = db.createObjectStore(IDB_STORE, { keyPath: 'key' });
      } else {
        store = (e.target as IDBOpenDBRequest).transaction!.objectStore(IDB_STORE);
      }
      if (!store.indexNames.contains('by_download')) {
        store.createIndex('by_download', 'downloadId', { unique: false });
      }
    };
    req.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      db.onclose = () => { cachedDbPromise = null; };
      db.onversionchange = () => { db.close(); cachedDbPromise = null; };
      resolve(db);
    };
    req.onerror = (e) => {
      cachedDbPromise = null;
      reject((e.target as IDBOpenDBRequest).error);
    };
  });

  return cachedDbPromise;
}

/** Save a chunk (Blob or ArrayBuffer) with downloadId index metadata. */
export async function saveChunk(downloadId: string, chunkIndex: number, chunk: ArrayBuffer | Blob): Promise<void> {
  const db  = await openIDB();
  if (!db) return;
  const key = `${downloadId}_${chunkIndex}`;
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req   = store.put({ key, downloadId, chunkIndex, buffer: chunk });
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject((e.target as IDBRequest).error);
  });
}

/** Load a chunk (ArrayBuffer or Blob). */
export async function loadChunk(downloadId: string, chunkIndex: number): Promise<ArrayBuffer | Blob | null> {
  const db  = await openIDB();
  if (!db) return null;
  const key = `${downloadId}_${chunkIndex}`;
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req   = store.get(key);
    req.onsuccess = (e) => {
      const res = (e.target as IDBRequest).result;
      resolve(res?.buffer || res?.blob || null);
    };
    req.onerror   = (e) => reject((e.target as IDBRequest).error);
  });
}

/** Load all chunks in sequential order using a single batch transaction. */
export async function loadAllChunks(downloadId: string, count: number): Promise<(ArrayBuffer | Blob)[]> {
  const db = await openIDB();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const results: (ArrayBuffer | Blob)[] = new Array(count);
    let loaded = 0;
    let failed = false;

    if (count <= 0) {
      resolve([]);
      return;
    }

    for (let i = 0; i < count; i++) {
      const req = store.get(`${downloadId}_${i}`);
      req.onsuccess = () => {
        if (failed) return;
        const res = req.result;
        results[i] = res?.buffer || res?.blob;
        loaded++;
        if (loaded === count) {
          resolve(results);
        }
      };
      req.onerror = (e) => {
        failed = true;
        reject((e.target as IDBRequest).error);
      };
    }
  });
}

/** Delete all chunks for a download using index search (fast O(K)) instead of full table scan. */
export async function clearChunks(downloadId: string): Promise<void> {
  const db = await openIDB();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);

    if (store.indexNames.contains('by_download')) {
      const index = store.index('by_download');
      const req = index.openKeyCursor(IDBKeyRange.only(downloadId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    } else {
      // Fallback for pre-index schemas
      const req = store.openCursor();
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
    }
  });
}

/** Count how many chunk segments exist in IndexedDB for a given downloadId. */
export async function getChunkCount(downloadId: string): Promise<number> {
  const db = await openIDB();
  if (!db) return 0;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);

    if (store.indexNames.contains('by_download')) {
      const index = store.index('by_download');
      const req = index.count(IDBKeyRange.only(downloadId));
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    } else {
      let count = 0;
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          if (typeof cursor.key === 'string' && cursor.key.startsWith(`${downloadId}_`)) {
            count++;
          }
          cursor.continue();
        } else {
          resolve(count);
        }
      };
      req.onerror = () => reject((req as any).error);
    }
  });
}
