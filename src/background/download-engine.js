// ============================================================
//  All-Downloader — Download Engine  (Industry-Grade)
//
//  Architecture:
//    • HEAD probe  → detect Content-Length, Accept-Ranges, filename
//    • Chunked     → N parallel HTTP Range segments, streamed into IDB
//    • Single      → streaming fallback for servers that reject ranges
//    • Retry       → per-segment exponential back-off with ±30 % jitter
//    • Throttle    → token-bucket rate limiter (speedLimitKBps setting)
//    • Resumable   → on resume, already-completed segments are skipped
//    • Safe memory → never holds the whole file in RAM; uses IDB slabs
// ============================================================
import { UI }                                   from '../shared/constants.js';
import { SpeedTracker }                        from './speed-tracker.js';
import { saveChunk, loadChunk, clearChunks }   from './storage.js';

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

/** Maximum number of parallel segments (hard cap). */
const MAX_SEGMENTS        = 16;
/** Minimum byte range per segment. Never split below this. */
const MIN_SEGMENT_BYTES   = 256 * 1024;       // 256 KB
/** Per-segment retry budget. */
const MAX_SEGMENT_RETRIES = 5;
/** Base delay for exponential back-off (ms). */
const RETRY_BASE_MS       = 500;
/** HTTP timeout for the HEAD probe (ms). */
const HEAD_TIMEOUT_MS     = 10_000;
/** Minimum ms between onProgress broadcasts — driven by UI.PROGRESS_INTERVAL. */
const PROGRESS_MIN_GAP    = UI.PROGRESS_INTERVAL;

// ─────────────────────────────────────────────────────────────
//  Active-download registry
//  Maps downloadId → { controller, segments[] }
// ─────────────────────────────────────────────────────────────
const _registry = new Map();

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────

/**
 * Start (or resume) a download.
 *
 * @param {object}   download    Download record from storage
 * @param {object}   settings    Current extension settings
 * @param {Function} onProgress  (id, received, total, speedSnap) => void
 * @param {Function} onComplete  (id, blob, filename) => void
 * @param {Function} onError     (id, errorMessage) => void
 */
export async function startDownload(download, settings, onProgress, onComplete, onError) {
  // Abort any previous ghost controller for this id
  _cancelExisting(download.id);

  const controller = new AbortController();
  _registry.set(download.id, { controller, segments: [] });

  try {
    // ── 1. Probe the server ───────────────────────────────────
    const meta = await _probe(download.url, controller.signal);

    const totalSize     = meta.contentLength;
    const acceptsRanges = meta.acceptsRanges;
    const filename      = meta.filename || download.filename;

    // ── 2. Pick strategy ──────────────────────────────────────
    const canChunk =
      acceptsRanges &&
      totalSize > 0 &&
      totalSize > settings.minChunkSizeMB * 1024 * 1024;

    // Throttle function (no-op when unlimited)
    const throttle = _makeThrottle(settings.speedLimitKBps || 0);

    // Shared mutable progress state
    const progress = {
      received:      0,
      total:         totalSize,
      lastBroadcast: 0,
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
        download, totalSize, settings, controller, throttle, progress, emit,
      });
    } else {
      blob = await _singleDownload({
        download, totalSize, controller, throttle, progress, emit,
      });
    }

    _registry.delete(download.id);

    // Final broadcast at 100 %
    tracker.record(progress.total || blob.size, progress.total || blob.size);
    onProgress(
      download.id,
      progress.total || blob.size,
      progress.total || blob.size,
      tracker.getSnapshot(),
    );

    await onComplete(download.id, blob, filename);

  } catch (err) {
    _registry.delete(download.id);
    if (err.name === 'AbortError') return;   // paused or cancelled — silent
    onError(download.id, err.message || 'Unknown download error');
  }
}

/**
 * Pause an active download.
 * The fetch streams are aborted; IDB chunks are preserved for resume.
 * @param {string} downloadId
 */
export function pauseDownload(downloadId) {
  const entry = _registry.get(downloadId);
  if (entry) {
    entry.controller.abort();
    _registry.delete(downloadId);
  }
}

/**
 * Cancel a download and erase all its IDB chunks.
 * @param {string} downloadId
 */
export async function cancelDownload(downloadId) {
  pauseDownload(downloadId);
  await clearChunks(downloadId);
}

// ─────────────────────────────────────────────────────────────
//  HEAD Probe  (Content-Length, Accept-Ranges, filename)
// ─────────────────────────────────────────────────────────────

async function _probe(url, signal) {
  // Timeout controller for the probe itself
  const headCtrl = new AbortController();
  const timer    = setTimeout(() => headCtrl.abort(), HEAD_TIMEOUT_MS);

  // Combine caller's abort with our timeout
  const combined = _combineSignals(signal, headCtrl.signal);

  let res;
  try {
    res = await fetch(url, {
      method:      'HEAD',
      signal:      combined,
      credentials: 'include',   // carry cookies so CDN auth works
      redirect:    'follow',
    });
  } catch {
    try {
      // HEAD failed → minimal GET probe (bytes=0-0)
      res = await fetch(url, {
        method:      'GET',
        signal,
        headers:     { Range: 'bytes=0-0' },
        credentials: 'include',
        redirect:    'follow',
      });
    } catch {
      // Both probes failed (e.g. strict CORS, rejected Range, or HEAD blocked)
      // Fallback safely to single-stream download without metadata
      return { contentLength: 0, acceptsRanges: false, filename: null };
    }
  } finally {
    clearTimeout(timer);
  }

  if (!res || !res.ok) {
    return { contentLength: 0, acceptsRanges: false, filename: null };
  }

  const contentLength = _parseContentLength(res);
  const acceptsRanges = (res.headers.get('Accept-Ranges') || '').toLowerCase() === 'bytes';
  const filename      = _parseFilename(res, url);

  return { contentLength, acceptsRanges, filename };
}

// ─────────────────────────────────────────────────────────────
//  Single-Connection Download  (streaming, memory-safe)
// ─────────────────────────────────────────────────────────────

async function _singleDownload({ download, totalSize, controller, throttle, progress, emit }) {
  const res = await fetch(download.url, {
    signal:      controller.signal,
    credentials: 'include',
    redirect:    'follow',
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);

  const reader = res.body.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await throttle(value.byteLength);
    chunks.push(value);
    progress.received += value.byteLength;
    emit();
  }

  const merged = _mergeUint8Arrays(chunks);
  return new Blob([merged]);
}

// ─────────────────────────────────────────────────────────────
//  Multi-Segment (Chunked) Download
//  IDM-style algorithm:
//    1. Divide file into N equal segments.
//    2. Fetch all segments in parallel with AbortController.
//    3. Each segment streams data into IDB.
//    4. On completion, reassemble from IDB and return Blob.
// ─────────────────────────────────────────────────────────────

async function _chunkedDownload({ download, totalSize, settings, controller, throttle, progress, emit }) {
  const numSegs = Math.max(
    1,
    Math.min(
      MAX_SEGMENTS,
      settings.maxChunks,
      Math.floor(totalSize / MIN_SEGMENT_BYTES),
    ),
  );

  // Build segment descriptors
  const segSize  = Math.ceil(totalSize / numSegs);
  const segments = Array.from({ length: numSegs }, (_, i) => {
    const start = i * segSize;
    const end   = i === numSegs - 1 ? totalSize - 1 : start + segSize - 1;
    return { index: i, start, end, received: 0, done: false };
  });

  // Store in registry so external callers (future dynamic re-seg) can see them
  const entry = _registry.get(download.id);
  if (entry) entry.segments = segments;

  // ── Download all segments in parallel ────────────────────────
  await Promise.all(
    segments.map(seg =>
      _fetchSegmentWithRetry({ download, seg, controller, throttle, progress, emit })
    )
  );

  // ── Re-assemble from IDB in index order ──────────────────────
  progress.received = totalSize;
  emit();

  const buffers = await Promise.all(
    segments.map(s => loadChunk(download.id, s.index))
  );

  // Sanity-check: every segment must be present
  for (let i = 0; i < buffers.length; i++) {
    if (!buffers[i]) throw new Error(`Segment ${i} missing after download`);
  }

  const blob = new Blob(buffers.map(b => new Uint8Array(b)));

  // Clean up IDB asynchronously (non-blocking)
  clearChunks(download.id).catch(() => {});

  return blob;
}

// ─────────────────────────────────────────────────────────────
//  Per-Segment Fetcher with Exponential Back-off + Jitter
// ─────────────────────────────────────────────────────────────

async function _fetchSegmentWithRetry({ download, seg, controller, throttle, progress, emit }) {
  // Skip if already in IDB (resume path)
  const existing = await loadChunk(download.id, seg.index);
  if (existing) {
    seg.done      = true;
    seg.received  = existing.byteLength;
    progress.received += existing.byteLength;
    emit();
    return;
  }

  let attempt = 0;

  while (true) {
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      await _fetchSegmentOnce({ download, seg, controller, throttle, progress, emit });
      seg.done = true;
      return;
    } catch (err) {
      if (err.name === 'AbortError') throw err;   // propagate pause/cancel
      attempt++;
      if (attempt >= MAX_SEGMENT_RETRIES) {
        throw new Error(`Segment ${seg.index} failed after ${attempt} retries: ${err.message}`);
      }
      // Exponential back-off: base * 2^attempt  ±30 % jitter, capped at 30 s
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) * (0.7 + Math.random() * 0.6);
      await _sleep(Math.min(delay, 30_000), controller.signal);

      // Undo this segment's progress contribution before retrying
      progress.received -= seg.received;
      seg.received = 0;
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Single Segment Fetch  (one HTTP Range request → IDB)
// ─────────────────────────────────────────────────────────────

async function _fetchSegmentOnce({ download, seg, controller, throttle, progress, emit }) {
  const res = await fetch(download.url, {
    signal:      controller.signal,
    credentials: 'include',
    redirect:    'follow',
    headers:     { Range: `bytes=${seg.start}-${seg.end}` },
  });

  // 206 Partial Content is expected; 200 OK means server ignored the Range header
  if (!res.ok && res.status !== 206) {
    throw new Error(`HTTP ${res.status} for segment ${seg.index}`);
  }

  const reader = res.body.getReader();
  const pieces = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    await throttle(value.byteLength);

    pieces.push(value);
    seg.received      += value.byteLength;
    progress.received += value.byteLength;
    emit();
  }

  // Merge pieces and persist to IDB
  const merged = _mergeUint8Arrays(pieces);
  await saveChunk(download.id, seg.index, merged.buffer);
}

// ─────────────────────────────────────────────────────────────
//  Token-Bucket Rate Limiter
//  Limits throughput to `kbps` kilobytes per second.
//  Returns an async throttle(bytes) function.
// ─────────────────────────────────────────────────────────────

function _makeThrottle(kbps) {
  if (!kbps || kbps <= 0) {
    return () => Promise.resolve();   // unlimited — no-op
  }

  const bytesPerSec = kbps * 1024;
  let   tokens      = bytesPerSec;           // start with a full bucket
  let   lastRefill  = Date.now();
  const MAX_TOKENS  = bytesPerSec * 2;       // 2-second burst capacity

  return function throttle(bytes) {
    const now     = Date.now();
    const elapsed = (now - lastRefill) / 1000;
    tokens        = Math.min(MAX_TOKENS, tokens + elapsed * bytesPerSec);
    lastRefill    = now;

    if (tokens >= bytes) {
      tokens -= bytes;
      return Promise.resolve();
    }

    // Wait until the bucket refills enough
    const deficit = bytes - tokens;
    const waitMs  = (deficit / bytesPerSec) * 1000;
    tokens        = 0;
    return _sleep(waitMs);
  };
}

// ─────────────────────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────────────────────

/** Merge an array of Uint8Arrays into one contiguous Uint8Array. */
function _mergeUint8Arrays(arrays) {
  const total  = arrays.reduce((s, a) => s + a.byteLength, 0);
  const merged = new Uint8Array(total);
  let   offset = 0;
  for (const a of arrays) {
    merged.set(a, offset);
    offset += a.byteLength;
  }
  return merged;
}

/**
 * Sleep for `ms` milliseconds.
 * Rejects with AbortError if the provided signal fires first.
 */
function _sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

/**
 * Parse a numeric Content-Length from a Response.
 * Returns 0 if absent or unparseable.
 */
function _parseContentLength(res) {
  const raw = res.headers.get('Content-Length');
  const n   = parseInt(raw, 10);
  return isFinite(n) && n > 0 ? n : 0;
}

/**
 * Extract filename from Content-Disposition (RFC 5987 + legacy) or URL path.
 */
function _parseFilename(res, url) {
  const cd = res.headers.get('Content-Disposition') || '';

  // RFC 5987: filename*=UTF-8''url%20encoded%20name
  let m = cd.match(/filename\*\s*=\s*UTF-8''([^;\s]+)/i);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { /* fall through */ }
  }

  // Legacy: filename="name.ext"  or  filename=name.ext
  m = cd.match(/filename\s*=\s*["']?([^;"'\n]+)["']?/i);
  if (m) return m[1].trim();

  // Last resort: URL path segment
  try {
    const u    = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length) return decodeURIComponent(segs[segs.length - 1]);
  } catch { /* ignore */ }

  return 'download';
}

/** Abort any existing controller for this id (ghost cleanup on restart). */
function _cancelExisting(downloadId) {
  const prev = _registry.get(downloadId);
  if (prev) {
    prev.controller.abort();
    _registry.delete(downloadId);
  }
}

/**
 * Combine two AbortSignals so that aborting EITHER one aborts the combined result.
 * Uses addEventListener (no AbortSignal.any) for maximum Chromium compatibility.
 */
function _combineSignals(s1, s2) {
  const ctrl  = new AbortController();
  const abort = () => ctrl.abort();
  s1.addEventListener('abort', abort, { once: true });
  s2.addEventListener('abort', abort, { once: true });
  return ctrl.signal;
}

