// src/shared/constants.ts
var DOWNLOAD_STATE = Object.freeze({
  QUEUED: "queued",
  CONNECTING: "connecting",
  DOWNLOADING: "downloading",
  PAUSED: "paused",
  MERGING: "merging",
  VERIFYING: "verifying",
  COMPLETED: "completed",
  ERROR: "error",
  CANCELLED: "cancelled"
});
var FILE_CATEGORY = Object.freeze({
  VIDEO: "video",
  AUDIO: "audio",
  IMAGE: "image",
  DOCUMENT: "document",
  ARCHIVE: "archive",
  APPLICATION: "application",
  OTHER: "other"
});
var CATEGORY_MAP = Object.freeze({
  video: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg"],
  audio: ["mp3", "aac", "flac", "wav", "ogg", "m4a", "wma", "opus"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "tiff"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "json", "xml"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"],
  application: ["exe", "msi", "dmg", "apk", "deb", "rpm", "pkg"]
});
var MSG = Object.freeze({
  // SW → UI
  DOWNLOAD_ADDED: "DOWNLOAD_ADDED",
  DOWNLOAD_PROGRESS: "DOWNLOAD_PROGRESS",
  DOWNLOAD_COMPLETED: "DOWNLOAD_COMPLETED",
  DOWNLOAD_ERROR: "DOWNLOAD_ERROR",
  DOWNLOAD_PAUSED: "DOWNLOAD_PAUSED",
  DOWNLOAD_RESUMED: "DOWNLOAD_RESUMED",
  DOWNLOAD_CANCELLED: "DOWNLOAD_CANCELLED",
  STATE_SNAPSHOT: "STATE_SNAPSHOT",
  // UI → SW
  GET_DOWNLOADS: "GET_DOWNLOADS",
  PAUSE_DOWNLOAD: "PAUSE_DOWNLOAD",
  RESUME_DOWNLOAD: "RESUME_DOWNLOAD",
  CANCEL_DOWNLOAD: "CANCEL_DOWNLOAD",
  RETRY_DOWNLOAD: "RETRY_DOWNLOAD",
  START_DOWNLOAD: "START_DOWNLOAD",
  DELETE_DOWNLOAD: "DELETE_DOWNLOAD",
  UPDATE_SETTINGS: "UPDATE_SETTINGS",
  GET_SETTINGS: "GET_SETTINGS",
  CLEAR_HISTORY: "CLEAR_HISTORY",
  OPEN_DASHBOARD: "OPEN_DASHBOARD",
  PRIORITIZE_DOWNLOAD: "PRIORITIZE_DOWNLOAD",
  MOVE_QUEUE_ITEM: "MOVE_QUEUE_ITEM",
  START_QUEUED_NOW: "START_QUEUED_NOW",
  CLEAR_QUEUE: "CLEAR_QUEUE",
  SHOW_IN_FOLDER: "SHOW_IN_FOLDER"
});
var STORAGE_KEY = Object.freeze({
  DOWNLOADS: "all_downloader_downloads",
  SETTINGS: "all_downloader_settings",
  STATS: "all_downloader_stats"
});
var DEFAULT_SETTINGS = Object.freeze({
  maxConcurrent: 3,
  // max simultaneous downloads
  maxChunks: 8,
  // segments per file
  minChunkSizeMB: 2,
  // min file size to chunk (MB)
  speedLimitKBps: 0,
  // 0 = unlimited
  defaultSavePath: "",
  // empty = browser default
  autoStart: true,
  // auto-start queued downloads
  showNotifications: true,
  // OS notifications on complete
  verifyIntegrity: true,
  // SHA-256 check when server provides hash
  interceptDownloads: true,
  // intercept all browser downloads
  darkMode: true,
  maxHistoryItems: 500
});
var UI = Object.freeze({
  POPUP_MAX_VISIBLE: 7,
  // max download items in popup
  PROGRESS_INTERVAL: 500,
  // ms between progress broadcasts
  SPEED_SAMPLE_WINDOW: 3e3
  // ms window for speed average
});
var COLORS = Object.freeze({
  skyBlue: "#8ecae6",
  ocean: "#219ebc",
  navy: "#023047",
  amber: "#ffb703",
  orange: "#fb8500"
});

// src/shared/utils.ts
function getFilenameFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    const last = parts[parts.length - 1];
    return decodeURIComponent(last) || "download";
  } catch {
    return "download";
  }
}
function getExtension(filename) {
  if (!filename) return "";
  const parts = filename.split(".");
  return parts.length > 1 ? (parts[parts.length - 1] || "").toLowerCase() : "";
}
function detectCategory(filename) {
  const ext = getExtension(filename);
  for (const [cat, exts] of Object.entries(CATEGORY_MAP)) {
    if (exts.includes(ext)) {
      return cat;
    }
  }
  return FILE_CATEGORY.OTHER;
}
function generateId() {
  return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function calcPercent(received, total) {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round(received / total * 100));
}

// src/background/storage.ts
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
async function loadDownloads() {
  const result = await storageGet([STORAGE_KEY.DOWNLOADS]);
  return result[STORAGE_KEY.DOWNLOADS] || {};
}
async function saveDownloads(downloadsMap) {
  await storageSet({ [STORAGE_KEY.DOWNLOADS]: downloadsMap });
}
async function upsertDownload(download) {
  const all = await loadDownloads();
  all[download.id] = download;
  await saveDownloads(all);
  return download;
}
async function getDownload(id) {
  const all = await loadDownloads();
  return all[id] || null;
}
async function deleteDownload(id) {
  const all = await loadDownloads();
  delete all[id];
  await saveDownloads(all);
}
async function clearHistory() {
  const all = await loadDownloads();
  const active = {};
  for (const [id, dl] of Object.entries(all)) {
    const st = dl.status || dl.state;
    if (["downloading", "queued", "paused", "connecting"].includes(st)) {
      active[id] = dl;
    }
  }
  await saveDownloads(active);
}
async function loadSettings() {
  const result = await storageGet([STORAGE_KEY.SETTINGS]);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY.SETTINGS] || {} };
}
async function saveSettings(partial) {
  const current = await loadSettings();
  const merged = { ...current, ...partial };
  await storageSet({ [STORAGE_KEY.SETTINGS]: merged });
  return merged;
}
async function loadStats() {
  const result = await storageGet([STORAGE_KEY.STATS]);
  return result[STORAGE_KEY.STATS] || {
    totalDownloadedBytes: 0,
    totalCompletedFiles: 0,
    totalFailedFiles: 0,
    totalDownloaded: 0,
    totalFiles: 0,
    totalTime: 0,
    sessionsCount: 0
  };
}
async function recordCompletion(bytes, durationMs) {
  const stats = await loadStats();
  stats.totalDownloadedBytes = (stats.totalDownloadedBytes || 0) + bytes;
  stats.totalCompletedFiles = (stats.totalCompletedFiles || 0) + 1;
  stats.totalDownloaded = (stats.totalDownloaded || 0) + bytes;
  stats.totalFiles = (stats.totalFiles || 0) + 1;
  stats.totalTime = (stats.totalTime || 0) + durationMs;
  await storageSet({ [STORAGE_KEY.STATS]: stats });
}
var IDB_NAME = "AllDownloaderChunks";
var IDB_VERSION = 1;
var IDB_STORE = "chunks";
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      db.createObjectStore(IDB_STORE, { keyPath: "key" });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
async function saveChunk(downloadId, chunkIndex, buffer) {
  const db = await openIDB();
  const key = `${downloadId}_${chunkIndex}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.put({ key, buffer });
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}
async function loadChunk(downloadId, chunkIndex) {
  const db = await openIDB();
  const key = `${downloadId}_${chunkIndex}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(key);
    req.onsuccess = (e) => resolve(e.target.result?.buffer || null);
    req.onerror = (e) => reject(e.target.error);
  });
}
async function clearChunks(downloadId) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (typeof cursor.key === "string" && cursor.key.startsWith(`${downloadId}_`)) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

// src/background/speed-tracker.ts
var SpeedTracker = class {
  windowMs;
  samples;
  bytesPerSec;
  etaSec;
  constructor(windowMs = UI.SPEED_SAMPLE_WINDOW) {
    this.windowMs = windowMs;
    this.samples = [];
    this.bytesPerSec = 0;
    this.etaSec = Infinity;
  }
  /**
   * Record a new byte count (absolute, not delta).
   * Call this on every progress event.
   */
  record(totalReceived, totalSize) {
    const now = Date.now();
    this.samples.push({ time: now, bytes: totalReceived });
    const cutoff = now - this.windowMs;
    while (this.samples.length > 1 && (this.samples[0]?.time ?? 0) < cutoff) {
      this.samples.shift();
    }
    if (this.samples.length < 2) {
      this.bytesPerSec = 0;
      this.etaSec = Infinity;
      return;
    }
    const oldest = this.samples[0];
    const newest = this.samples[this.samples.length - 1];
    const bytesDelta = newest.bytes - oldest.bytes;
    const timeDelta = (newest.time - oldest.time) / 1e3;
    this.bytesPerSec = timeDelta > 0 ? bytesDelta / timeDelta : 0;
    if (totalSize > 0 && this.bytesPerSec > 0) {
      const remaining = totalSize - totalReceived;
      this.etaSec = remaining / this.bytesPerSec;
    } else {
      this.etaSec = Infinity;
    }
  }
  /** Reset (called on resume to avoid stale samples). */
  reset() {
    this.samples = [];
    this.bytesPerSec = 0;
    this.etaSec = Infinity;
  }
  /** Get current snapshot. */
  getSnapshot() {
    return {
      bytesPerSec: Math.round(this.bytesPerSec),
      etaSec: isFinite(this.etaSec) ? Math.ceil(this.etaSec) : null
    };
  }
};

// src/background/download-engine.ts
var MAX_SEGMENTS = 16;
var MIN_SEGMENT_BYTES = 256 * 1024;
var MAX_SEGMENT_RETRIES = 5;
var RETRY_BASE_MS = 500;
var HEAD_TIMEOUT_MS = 1e4;
var PROGRESS_MIN_GAP = UI.PROGRESS_INTERVAL;
var _registry = /* @__PURE__ */ new Map();
async function startDownload(download, settings2, onProgress, onComplete, onError) {
  _cancelExisting(download.id);
  const controller = new AbortController();
  _registry.set(download.id, { controller, segments: [] });
  try {
    const meta = await _probe(download.url, controller.signal);
    const totalSize = meta.contentLength;
    const acceptsRanges = meta.acceptsRanges;
    const filename = meta.filename || download.filename;
    const canChunk = acceptsRanges && totalSize > 0 && totalSize > settings2.minChunkSizeMB * 1024 * 1024;
    const throttle = _makeThrottle(settings2.speedLimitKBps || 0);
    const progress = {
      received: 0,
      total: totalSize,
      lastBroadcast: 0
    };
    const tracker = new SpeedTracker();
    const emit = () => {
      const now = Date.now();
      if (now - progress.lastBroadcast < PROGRESS_MIN_GAP) return;
      progress.lastBroadcast = now;
      tracker.record(progress.received, progress.total);
      onProgress(download.id, progress.received, progress.total, tracker.getSnapshot());
    };
    let blob;
    if (canChunk) {
      blob = await _chunkedDownload({
        download,
        totalSize,
        settings: settings2,
        controller,
        throttle,
        progress,
        emit
      });
    } else {
      blob = await _singleDownload({
        download,
        controller,
        throttle,
        progress,
        emit
      });
    }
    _registry.delete(download.id);
    tracker.record(progress.total || blob.size, progress.total || blob.size);
    onProgress(
      download.id,
      progress.total || blob.size,
      progress.total || blob.size,
      tracker.getSnapshot()
    );
    await onComplete(download.id, blob, filename);
  } catch (err) {
    _registry.delete(download.id);
    if (err?.name === "AbortError") return;
    onError(download.id, err?.message || "Unknown download error");
  }
}
function pauseDownload(downloadId) {
  const entry = _registry.get(downloadId);
  if (entry) {
    entry.controller.abort();
    _registry.delete(downloadId);
  }
}
async function cancelDownload(downloadId) {
  pauseDownload(downloadId);
  await clearChunks(downloadId);
}
async function _probe(url, signal) {
  const headCtrl = new AbortController();
  const timer = setTimeout(() => headCtrl.abort(), HEAD_TIMEOUT_MS);
  const combined = _combineSignals(signal, headCtrl.signal);
  let res = null;
  try {
    res = await fetch(url, {
      method: "HEAD",
      signal: combined,
      credentials: "include",
      redirect: "follow"
    });
  } catch {
    try {
      res = await fetch(url, {
        method: "GET",
        signal,
        headers: { Range: "bytes=0-0" },
        credentials: "include",
        redirect: "follow"
      });
    } catch {
      return { contentLength: 0, acceptsRanges: false, filename: null };
    }
  } finally {
    clearTimeout(timer);
  }
  if (!res || !res.ok) {
    return { contentLength: 0, acceptsRanges: false, filename: null };
  }
  const contentLength = _parseContentLength(res);
  const acceptsRanges = (res.headers.get("Accept-Ranges") || "").toLowerCase() === "bytes";
  const filename = _parseFilename(res, url);
  return { contentLength, acceptsRanges, filename };
}
async function _singleDownload({ download, controller, throttle, progress, emit }) {
  const res = await fetch(download.url, {
    signal: controller.signal,
    credentials: "include",
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} \u2014 ${res.statusText}`);
  if (!res.body) throw new Error("Response body is null");
  const reader = res.body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      await throttle(value.byteLength);
      chunks.push(value);
      progress.received += value.byteLength;
      emit();
    }
  }
  const merged = _mergeUint8Arrays(chunks);
  return new Blob([merged.buffer]);
}
async function _chunkedDownload({ download, totalSize, settings: settings2, controller, throttle, progress, emit }) {
  const numSegs = Math.max(
    1,
    Math.min(
      MAX_SEGMENTS,
      settings2.maxChunks,
      Math.floor(totalSize / MIN_SEGMENT_BYTES)
    )
  );
  const segSize = Math.ceil(totalSize / numSegs);
  const segments = Array.from({ length: numSegs }, (_, i) => {
    const start = i * segSize;
    const end = i === numSegs - 1 ? totalSize - 1 : start + segSize - 1;
    return { index: i, start, end, received: 0, done: false };
  });
  const entry = _registry.get(download.id);
  if (entry) entry.segments = segments;
  await Promise.all(
    segments.map(
      (seg) => _fetchSegmentWithRetry({ download, seg, controller, throttle, progress, emit })
    )
  );
  progress.received = totalSize;
  emit();
  const buffers = await Promise.all(
    segments.map((s) => loadChunk(download.id, s.index))
  );
  for (let i = 0; i < buffers.length; i++) {
    if (!buffers[i]) throw new Error(`Segment ${i} missing after download`);
  }
  const blob = new Blob(buffers.map((b) => new Uint8Array(b)));
  clearChunks(download.id).catch(() => {
  });
  return blob;
}
async function _fetchSegmentWithRetry({ download, seg, controller, throttle, progress, emit }) {
  const existing = await loadChunk(download.id, seg.index);
  if (existing) {
    seg.done = true;
    seg.received = existing.byteLength;
    progress.received += existing.byteLength;
    emit();
    return;
  }
  let attempt = 0;
  while (true) {
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      await _fetchSegmentOnce({ download, seg, controller, throttle, progress, emit });
      seg.done = true;
      return;
    } catch (err) {
      if (err.name === "AbortError") throw err;
      attempt++;
      if (attempt >= MAX_SEGMENT_RETRIES) {
        throw new Error(`Segment ${seg.index} failed after ${attempt} retries: ${err.message}`);
      }
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) * (0.7 + Math.random() * 0.6);
      await _sleep(Math.min(delay, 3e4), controller.signal);
      progress.received -= seg.received;
      seg.received = 0;
    }
  }
}
async function _fetchSegmentOnce({ download, seg, controller, throttle, progress, emit }) {
  const res = await fetch(download.url, {
    signal: controller.signal,
    credentials: "include",
    redirect: "follow",
    headers: { Range: `bytes=${seg.start}-${seg.end}` }
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`HTTP ${res.status} for segment ${seg.index}`);
  }
  if (!res.body) throw new Error("Segment response body is null");
  const reader = res.body.getReader();
  const pieces = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      await throttle(value.byteLength);
      pieces.push(value);
      seg.received += value.byteLength;
      progress.received += value.byteLength;
      emit();
    }
  }
  const merged = _mergeUint8Arrays(pieces);
  await saveChunk(download.id, seg.index, merged.buffer);
}
function _makeThrottle(kbps) {
  if (!kbps || kbps <= 0) {
    return () => Promise.resolve();
  }
  const bytesPerSec = kbps * 1024;
  let tokens = bytesPerSec;
  let lastRefill = Date.now();
  const MAX_TOKENS = bytesPerSec * 2;
  return function throttle(bytes) {
    const now = Date.now();
    const elapsed = (now - lastRefill) / 1e3;
    tokens = Math.min(MAX_TOKENS, tokens + elapsed * bytesPerSec);
    lastRefill = now;
    if (tokens >= bytes) {
      tokens -= bytes;
      return Promise.resolve();
    }
    const deficit = bytes - tokens;
    const waitMs = deficit / bytesPerSec * 1e3;
    tokens = 0;
    return _sleep(waitMs);
  };
}
function _mergeUint8Arrays(arrays) {
  const total = arrays.reduce((s, a) => s + a.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    merged.set(a, offset);
    offset += a.byteLength;
  }
  return merged;
}
function _sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
function _parseContentLength(res) {
  const raw = res.headers.get("Content-Length");
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return isFinite(n) && n > 0 ? n : 0;
}
function _parseFilename(res, url) {
  const cd = res.headers.get("Content-Disposition") || "";
  let m = cd.match(/filename\*\s*=\s*UTF-8''([^;\s]+)/i);
  if (m && m[1]) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
    }
  }
  m = cd.match(/filename\s*=\s*["']?([^;"'\n]+)["']?/i);
  if (m && m[1]) return m[1].trim();
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1];
    if (last) return decodeURIComponent(last);
  } catch {
  }
  return "download";
}
function _cancelExisting(downloadId) {
  const prev = _registry.get(downloadId);
  if (prev) {
    prev.controller.abort();
    _registry.delete(downloadId);
  }
}
function _combineSignals(s1, s2) {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  s1.addEventListener("abort", abort, { once: true });
  s2.addEventListener("abort", abort, { once: true });
  return ctrl.signal;
}

// src/background/queue-manager.ts
var QueueManager = class {
  maxConcurrent;
  onDequeue;
  running;
  queue;
  scheduled;
  constructor({ maxConcurrent = 3, onDequeue } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.onDequeue = onDequeue;
    this.running = /* @__PURE__ */ new Set();
    this.queue = [];
    this.scheduled = /* @__PURE__ */ new Map();
  }
  // ── Configuration ─────────────────────────────────────────
  setMaxConcurrent(n) {
    this.maxConcurrent = Math.max(1, n);
    this._flush();
  }
  // ── Queue Operations ───────────────────────────────────────
  /**
   * Enqueue a download. If slots are free, starts immediately.
   */
  enqueue(downloadId, scheduledAt = null) {
    if (scheduledAt && scheduledAt > Date.now()) {
      this._scheduleAlarm(downloadId, scheduledAt);
      return;
    }
    if (!this.queue.includes(downloadId)) {
      this.queue.push(downloadId);
    }
    this._flush();
  }
  /**
   * Mark a download as started (running).
   */
  markRunning(downloadId) {
    this.running.add(downloadId);
    const idx = this.queue.indexOf(downloadId);
    if (idx !== -1) this.queue.splice(idx, 1);
  }
  /**
   * Mark a download as finished / paused / cancelled.
   * Frees a slot and triggers next in queue.
   */
  markDone(downloadId) {
    this.running.delete(downloadId);
    this._flush();
  }
  /**
   * Remove from queue (cancel queued-but-not-started).
   */
  remove(downloadId) {
    this.running.delete(downloadId);
    const idx = this.queue.indexOf(downloadId);
    if (idx !== -1) this.queue.splice(idx, 1);
    this._cancelAlarm(downloadId);
  }
  /**
   * Move a download to the front of the queue (priority boost).
   */
  prioritize(downloadId) {
    const idx = this.queue.indexOf(downloadId);
    if (idx > 0) {
      this.queue.splice(idx, 1);
      this.queue.unshift(downloadId);
    }
    this._flush();
  }
  /**
   * Move a download up or down in the queue sequence.
   */
  move(downloadId, direction) {
    const idx = this.queue.indexOf(downloadId);
    if (idx === -1) return false;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx >= 0 && targetIdx < this.queue.length) {
      this.queue.splice(idx, 1);
      this.queue.splice(targetIdx, 0, downloadId);
      return true;
    }
    return false;
  }
  /**
   * Remove and return all items in the waiting queue.
   */
  clear() {
    const cleared = [...this.queue];
    this.queue = [];
    return cleared;
  }
  // ── Introspection ──────────────────────────────────────────
  isRunning(downloadId) {
    return this.running.has(downloadId);
  }
  isQueued(downloadId) {
    return this.queue.includes(downloadId);
  }
  getQueueLength() {
    return this.queue.length;
  }
  getRunningCount() {
    return this.running.size;
  }
  hasFreeSlot() {
    return this.running.size < this.maxConcurrent;
  }
  /** Full status snapshot for debugging / dashboard display */
  getStatus() {
    return {
      running: [...this.running],
      queue: [...this.queue],
      maxConcurrent: this.maxConcurrent
    };
  }
  // ── Scheduling (chrome.alarms) ─────────────────────────────
  _scheduleAlarm(downloadId, atMs) {
    const name = `adl_sched_${downloadId}`;
    if (typeof chrome !== "undefined" && chrome.alarms) {
      chrome.alarms.create(name, { when: atMs });
    }
    this.scheduled.set(downloadId, atMs);
  }
  _cancelAlarm(downloadId) {
    const name = `adl_sched_${downloadId}`;
    if (typeof chrome !== "undefined" && chrome.alarms) {
      chrome.alarms.clear(name);
    }
    this.scheduled.delete(downloadId);
  }
  handleAlarm(alarmName) {
    if (!alarmName.startsWith("adl_sched_")) return;
    const downloadId = alarmName.replace("adl_sched_", "");
    this.scheduled.delete(downloadId);
    this.enqueue(downloadId, null);
  }
  // ── Internal flush ─────────────────────────────────────────
  _flush() {
    while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
      const next = this.queue.shift();
      if (!next) break;
      this.running.add(next);
      if (typeof this.onDequeue === "function") {
        this.onDequeue(next);
      }
    }
  }
};

// src/background/service-worker.ts
var settings = { ...DEFAULT_SETTINGS };
var downloadCache = /* @__PURE__ */ new Map();
var _ownBlobUrls = /* @__PURE__ */ new Set();
var queue = new QueueManager({
  maxConcurrent: settings.maxConcurrent,
  onDequeue: (downloadId) => {
    _executeDownload(downloadId);
  }
});
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[ADL] Extension installed / updated.");
  settings = await loadSettings();
  queue.setMaxConcurrent(settings.maxConcurrent);
  await _restoreInProgressDownloads();
  _setupContextMenu();
});
self.addEventListener("activate", async () => {
  settings = await loadSettings();
  queue.setMaxConcurrent(settings.maxConcurrent);
  await _restoreInProgressDownloads();
  _updateBadge();
});
chrome.downloads.onCreated.addListener(async (item) => {
  if (!settings.interceptDownloads) return;
  if (!item.url) return;
  if (_ownBlobUrls.has(item.url)) {
    _ownBlobUrls.delete(item.url);
    return;
  }
  if (item.url.startsWith("blob:") || item.url.startsWith("data:")) return;
  if (item.filename && (item.filename.startsWith("/") || /^[A-Za-z]:[/\\]/.test(item.filename))) {
    return;
  }
  chrome.downloads.cancel(item.id, () => {
    chrome.downloads.erase({ id: item.id });
  });
  await _addDownload({
    url: item.url,
    filename: item.filename || getFilenameFromUrl(item.url),
    referrer: item.referrer || ""
  });
});
function _setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "adl-download-link",
      title: "Download with All Downloader",
      contexts: ["link", "image", "video", "audio"]
    });
    chrome.contextMenus.create({
      id: "adl-open-dashboard",
      title: "Open All Downloader Dashboard",
      contexts: ["action"]
    });
  });
}
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "adl-download-link") {
    const url = info.linkUrl || info.srcUrl;
    if (url) await _addDownload({ url, filename: getFilenameFromUrl(url) });
  }
  if (info.menuItemId === "adl-open-dashboard") {
    _openDashboard();
  }
});
chrome.commands.onCommand.addListener((command) => {
  if (command === "open-dashboard") _openDashboard();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  queue.handleAlarm(alarm.name);
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  _handleMessage(msg).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err?.message || "Error handling message" });
  });
  return true;
});
async function _handleMessage(msg) {
  switch (msg?.type) {
    case MSG.GET_DOWNLOADS: {
      const all = await loadDownloads();
      return { ok: true, downloads: Object.values(all), queueOrder: queue.getStatus().queue };
    }
    case MSG.PRIORITIZE_DOWNLOAD: {
      queue.prioritize(msg.id);
      return { ok: true, queueOrder: queue.getStatus().queue };
    }
    case MSG.MOVE_QUEUE_ITEM: {
      queue.move(msg.id, msg.direction);
      return { ok: true, queueOrder: queue.getStatus().queue };
    }
    case MSG.START_QUEUED_NOW: {
      const dl = await getDownload(msg.id);
      if (!dl) return { ok: false };
      queue.remove(msg.id);
      queue.markRunning(msg.id);
      await _executeDownload(msg.id);
      return { ok: true, queueOrder: queue.getStatus().queue };
    }
    case MSG.CLEAR_QUEUE: {
      const ids = queue.clear();
      for (const id of ids) {
        await cancelDownload(id);
        await _updateState(id, DOWNLOAD_STATE.CANCELLED);
        _broadcast({ type: MSG.DOWNLOAD_CANCELLED, id });
      }
      return { ok: true, queueOrder: [] };
    }
    case MSG.START_DOWNLOAD: {
      const dl = await _addDownload(msg.payload || {});
      return { ok: true, download: dl };
    }
    case MSG.PAUSE_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      const state = dl?.status || dl?.state;
      if (!dl || state !== DOWNLOAD_STATE.DOWNLOADING) return { ok: false };
      pauseDownload(msg.id);
      await _updateState(msg.id, DOWNLOAD_STATE.PAUSED);
      queue.markDone(msg.id);
      _broadcast({ type: MSG.DOWNLOAD_PAUSED, id: msg.id });
      return { ok: true };
    }
    case MSG.RESUME_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      const state = dl?.status || dl?.state;
      if (!dl || state !== DOWNLOAD_STATE.PAUSED) return { ok: false };
      await _updateState(msg.id, DOWNLOAD_STATE.QUEUED);
      queue.enqueue(msg.id);
      return { ok: true };
    }
    case MSG.CANCEL_DOWNLOAD: {
      await cancelDownload(msg.id);
      await _updateState(msg.id, DOWNLOAD_STATE.CANCELLED);
      queue.remove(msg.id);
      _broadcast({ type: MSG.DOWNLOAD_CANCELLED, id: msg.id });
      return { ok: true };
    }
    case MSG.RETRY_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      if (!dl) return { ok: false };
      await _updateState(msg.id, DOWNLOAD_STATE.QUEUED, {
        errorMessage: null,
        error: null,
        receivedBytes: 0,
        received: 0,
        progress: 0,
        percent: 0
      });
      queue.enqueue(msg.id);
      return { ok: true };
    }
    case MSG.DELETE_DOWNLOAD: {
      await cancelDownload(msg.id);
      await deleteDownload(msg.id);
      queue.remove(msg.id);
      downloadCache.delete(msg.id);
      return { ok: true };
    }
    case MSG.GET_SETTINGS: {
      return { ok: true, settings };
    }
    case MSG.UPDATE_SETTINGS: {
      settings = await saveSettings(msg.payload);
      queue.setMaxConcurrent(settings.maxConcurrent);
      return { ok: true, settings };
    }
    case MSG.CLEAR_HISTORY: {
      await clearHistory();
      return { ok: true };
    }
    case MSG.OPEN_DASHBOARD: {
      _openDashboard();
      return { ok: true };
    }
    case MSG.SHOW_IN_FOLDER: {
      const dl = await getDownload(msg.id);
      if (!dl) return { ok: false };
      const filename = dl.filename || "";
      chrome.downloads.search(
        { filenameRegex: _escapeRegex(filename) + "$", limit: 1, orderBy: ["-startTime"] },
        (results) => {
          if (results && results.length > 0 && results[0]) {
            chrome.downloads.show(results[0].id);
          } else {
            chrome.tabs.create({ url: "chrome://downloads" });
          }
        }
      );
      return { ok: true };
    }
    default:
      return { ok: false, error: `Unknown message type: ${msg?.type}` };
  }
}
async function _addDownload({ url, filename, referrer = "", scheduledAt = null }) {
  const id = generateId();
  const name = filename || getFilenameFromUrl(url);
  const download = {
    id,
    url,
    filename: name,
    category: detectCategory(name),
    filesize: 0,
    receivedBytes: 0,
    progress: 0,
    speed: 0,
    eta: 0,
    status: DOWNLOAD_STATE.QUEUED,
    createdAt: Date.now(),
    errorMessage: null,
    error: null,
    scheduledTime: scheduledAt,
    ...{
      referrer,
      state: DOWNLOAD_STATE.QUEUED,
      total: 0,
      received: 0,
      percent: 0,
      startedAt: null,
      completedAt: null,
      scheduledAt,
      chunked: false,
      hash: null
    }
  };
  await upsertDownload(download);
  downloadCache.set(id, download);
  _broadcast({ type: MSG.DOWNLOAD_ADDED, download });
  _updateBadge();
  _autoOpenPopup();
  if (settings.autoStart) {
    queue.enqueue(id, scheduledAt);
  }
  return download;
}
async function _executeDownload(downloadId) {
  const dl = await getDownload(downloadId);
  if (!dl) {
    queue.markDone(downloadId);
    return;
  }
  await _updateState(downloadId, DOWNLOAD_STATE.CONNECTING, { startedAt: Date.now() });
  await startDownload(
    dl,
    settings,
    async (id, received, total, speedSnap) => {
      const percent = calcPercent(received, total);
      const update = {
        state: DOWNLOAD_STATE.DOWNLOADING,
        status: DOWNLOAD_STATE.DOWNLOADING,
        received,
        receivedBytes: received,
        total,
        filesize: total,
        percent,
        progress: percent,
        speed: speedSnap.bytesPerSec,
        eta: speedSnap.etaSec || 0
      };
      await _updateState(id, DOWNLOAD_STATE.DOWNLOADING, update);
      _broadcast({ type: MSG.DOWNLOAD_PROGRESS, id, ...update });
    },
    async (id, blob, finalFilename) => {
      try {
        await _updateState(id, DOWNLOAD_STATE.MERGING);
        const safeFilename = _sanitizeFilename(finalFilename);
        const savePath = _buildSavePath(settings.defaultSavePath, safeFilename);
        const dataUrl = await _blobToDataUrl(blob);
        chrome.downloads.download(
          {
            url: dataUrl,
            filename: savePath,
            saveAs: false,
            conflictAction: "uniquify"
          },
          (_dlId) => {
            if (chrome.runtime.lastError) {
              console.error("[ADL] save error:", chrome.runtime.lastError.message);
            }
          }
        );
        const completedAt = Date.now();
        const dlRecord = await getDownload(id);
        await _updateState(id, DOWNLOAD_STATE.COMPLETED, {
          completedAt,
          percent: 100,
          progress: 100,
          speed: 0,
          eta: 0,
          filename: safeFilename
        });
        await recordCompletion(blob.size, completedAt - (dlRecord?.startedAt || completedAt));
        queue.markDone(id);
        _broadcast({ type: MSG.DOWNLOAD_COMPLETED, id });
        if (settings.showNotifications) {
          chrome.notifications.create({
            type: "basic",
            iconUrl: chrome.runtime.getURL("src/assets/icons/icon48.png"),
            title: "Download Complete",
            message: safeFilename
          });
        }
      } catch (err) {
        console.error("[ADL] onComplete error:", err);
        await _updateState(id, DOWNLOAD_STATE.ERROR, {
          error: `Save failed: ${err?.message || "Unknown error"} \u2014 click Retry`,
          errorMessage: `Save failed: ${err?.message || "Unknown error"} \u2014 click Retry`
        });
        queue.markDone(id);
        _broadcast({ type: MSG.DOWNLOAD_ERROR, id, error: err?.message });
      }
    },
    async (id, errorMsg) => {
      await _updateState(id, DOWNLOAD_STATE.ERROR, {
        error: errorMsg,
        errorMessage: errorMsg
      });
      queue.markDone(id);
      _broadcast({ type: MSG.DOWNLOAD_ERROR, id, error: errorMsg });
    }
  );
}
async function _updateState(id, state, extra = {}) {
  const dl = downloadCache.get(id) || await getDownload(id) || {};
  const updated = {
    ...dl,
    id,
    status: state,
    state,
    ...extra
  };
  downloadCache.set(id, updated);
  await upsertDownload(updated);
  _updateBadge();
  return updated;
}
function _broadcast(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {
  });
}
function _updateBadge() {
  const ACTIVE_STATES = [
    DOWNLOAD_STATE.QUEUED,
    DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.DOWNLOADING,
    DOWNLOAD_STATE.PAUSED,
    DOWNLOAD_STATE.MERGING,
    DOWNLOAD_STATE.VERIFYING
  ];
  const activeCount = [...downloadCache.values()].filter(
    (dl) => ACTIVE_STATES.includes(dl.status || dl.state)
  ).length;
  if (activeCount > 0) {
    chrome.action.setBadgeBackgroundColor({ color: "#219ebc" });
    chrome.action.setBadgeText({ text: String(activeCount) });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}
function _autoOpenPopup() {
  if (chrome.storage && chrome.storage.session) {
    chrome.storage.session.set({ adl_autoOpened: true }).then(() => {
      if (typeof chrome.action.openPopup === "function") {
        chrome.action.openPopup().catch(() => {
          chrome.storage.session.remove("adl_autoOpened");
        });
      } else {
        chrome.storage.session.remove("adl_autoOpened");
      }
    });
  }
}
async function _restoreInProgressDownloads() {
  const all = await loadDownloads();
  for (const dl of Object.values(all)) {
    downloadCache.set(dl.id, dl);
    const st = dl.status || dl.state;
    if (st === "downloading" || st === "connecting" || st === "queued") {
      await _updateState(dl.id, DOWNLOAD_STATE.QUEUED, { speed: 0, eta: null });
      queue.enqueue(dl.id);
    } else if (st === "merging" || st === "verifying") {
      await _updateState(dl.id, DOWNLOAD_STATE.ERROR, {
        error: "Interrupted during merge \u2014 click Retry to re-download.",
        errorMessage: "Interrupted during merge \u2014 click Retry to re-download."
      });
      _broadcast({
        type: MSG.DOWNLOAD_ERROR,
        id: dl.id,
        error: "Interrupted during merge \u2014 click Retry to re-download."
      });
    }
  }
}
function _openDashboard() {
  const url = chrome.runtime.getURL("src/dashboard/dashboard.html");
  chrome.tabs.query({ url }, (tabs) => {
    if (tabs.length > 0 && tabs[0]?.id) {
      chrome.tabs.update(tabs[0].id, { active: true });
    } else {
      chrome.tabs.create({ url });
    }
  });
}
async function _blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const uint8 = new Uint8Array(buffer);
  const mimeType = blob.type || "application/octet-stream";
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < uint8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + CHUNK)));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
function _sanitizeFilename(name) {
  if (!name || typeof name !== "string") return "download";
  let safe = name.replace(/\0/g, "").replace(/[\\/:*?"<>|]/g, "_").replace(/[\x00-\x1f]/g, "").replace(/\s+/g, " ").trim();
  safe = safe.replace(/^\.+$/, "_");
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(safe)) {
    safe = "_" + safe;
  }
  if (safe.length > 200) {
    const ext = safe.lastIndexOf(".");
    const extPart = ext > 0 ? safe.slice(ext) : "";
    const namePart = ext > 0 ? safe.slice(0, ext) : safe;
    safe = namePart.slice(0, 200 - extPart.length) + extPart;
  }
  return safe || "download";
}
function _buildSavePath(subFolder, filename) {
  if (!subFolder || typeof subFolder !== "string" || !subFolder.trim()) {
    return filename;
  }
  const cleanFolder = subFolder.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "").split("/").map((seg) => _sanitizeFolderSegment(seg)).filter(Boolean).join("/");
  return cleanFolder ? `${cleanFolder}/${filename}` : filename;
}
function _sanitizeFolderSegment(seg) {
  if (!seg || typeof seg !== "string") return "";
  let safe = seg.replace(/\0/g, "").replace(/[\\/:*?"<>|]/g, "_").replace(/[\x00-\x1f]/g, "").replace(/\s+/g, " ").trim();
  if (/^\.+$/.test(safe)) return "";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(safe)) return "";
  if (safe.length > 100) safe = safe.slice(0, 100);
  return safe;
}
function _escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
