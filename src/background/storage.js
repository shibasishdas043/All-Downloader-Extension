// ============================================================
//  All-Downloader — Storage Layer
//  Wraps chrome.storage.local for download records + settings.
//  Uses a simple IndexedDB wrapper for large binary chunk caching.
// ============================================================
import { STORAGE_KEY, DEFAULT_SETTINGS } from '../shared/constants.js';

// ─────────────────────────────────────────────────────────────
//  chrome.storage helpers
// ─────────────────────────────────────────────────────────────

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    });
  });
}

function storageSet(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

// ─────────────────────────────────────────────────────────────
//  Downloads CRUD
// ─────────────────────────────────────────────────────────────

/** Load all download records from storage. */
export async function loadDownloads() {
  const result = await storageGet([STORAGE_KEY.DOWNLOADS]);
  return result[STORAGE_KEY.DOWNLOADS] || {};
}

/** Save the full downloads map to storage. */
export async function saveDownloads(downloadsMap) {
  await storageSet({ [STORAGE_KEY.DOWNLOADS]: downloadsMap });
}

/** Insert or update a single download record. */
export async function upsertDownload(download) {
  const all = await loadDownloads();
  all[download.id] = download;
  await saveDownloads(all);
  return download;
}

/** Get a single download by ID. */
export async function getDownload(id) {
  const all = await loadDownloads();
  return all[id] || null;
}

/** Delete a download record. */
export async function deleteDownload(id) {
  const all = await loadDownloads();
  delete all[id];
  await saveDownloads(all);
}

/** Clear all completed / cancelled download history. */
export async function clearHistory() {
  const all = await loadDownloads();
  const active = {};
  for (const [id, dl] of Object.entries(all)) {
    if (['downloading', 'queued', 'paused', 'connecting'].includes(dl.state)) {
      active[id] = dl;
    }
  }
  await saveDownloads(active);
}

/** Get downloads as sorted array (newest first). */
export async function getDownloadList() {
  const all = await loadDownloads();
  return Object.values(all).sort((a, b) => b.createdAt - a.createdAt);
}

// ─────────────────────────────────────────────────────────────
//  Settings CRUD
// ─────────────────────────────────────────────────────────────

/** Load settings, merged with defaults. */
export async function loadSettings() {
  const result = await storageGet([STORAGE_KEY.SETTINGS]);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY.SETTINGS] || {}) };
}

/** Save partial or full settings object. */
export async function saveSettings(partial) {
  const current = await loadSettings();
  const merged = { ...current, ...partial };
  await storageSet({ [STORAGE_KEY.SETTINGS]: merged });
  return merged;
}

// ─────────────────────────────────────────────────────────────
//  Stats
// ─────────────────────────────────────────────────────────────

/** Load lifetime stats. */
export async function loadStats() {
  const result = await storageGet([STORAGE_KEY.STATS]);
  return result[STORAGE_KEY.STATS] || {
    totalDownloaded: 0,
    totalFiles:      0,
    totalTime:       0,
    sessionsCount:   0,
  };
}

/** Increment stats after a completed download. */
export async function recordCompletion(bytes, durationMs) {
  const stats = await loadStats();
  stats.totalDownloaded += bytes;
  stats.totalFiles      += 1;
  stats.totalTime       += durationMs;
  await storageSet({ [STORAGE_KEY.STATS]: stats });
}

// ─────────────────────────────────────────────────────────────
//  IndexedDB — Chunk Cache (for pause/resume byte ranges)
// ─────────────────────────────────────────────────────────────

const IDB_NAME    = 'AllDownloaderChunks';
const IDB_VERSION = 1;
const IDB_STORE   = 'chunks';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE, { keyPath: 'key' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Save a chunk buffer for a given downloadId + chunkIndex. */
export async function saveChunk(downloadId, chunkIndex, buffer) {
  const db  = await openIDB();
  const key = `${downloadId}_${chunkIndex}`;
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req   = store.put({ key, buffer });
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Load a chunk buffer. */
export async function loadChunk(downloadId, chunkIndex) {
  const db  = await openIDB();
  const key = `${downloadId}_${chunkIndex}`;
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req   = store.get(key);
    req.onsuccess = (e) => resolve(e.target.result?.buffer || null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Delete all chunks for a download (after merge or cancel). */
export async function clearChunks(downloadId) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req   = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.key.startsWith(`${downloadId}_`)) cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
}
