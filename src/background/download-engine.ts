// ============================================================
//  All-Downloader — Download Engine (TypeScript)
// ============================================================
import { UI }                                   from '../shared/constants.js';
import { SpeedTracker, type SpeedSnapshot }    from './speed-tracker.js';
import { saveChunk, loadChunk, clearChunks }   from './storage.js';
import type { DownloadItem, ExtensionSettings, DownloadResult } from '../shared/types.js';

const MAX_SEGMENTS        = 16;
const MIN_SEGMENT_BYTES   = 256 * 1024;       // 256 KB
const MAX_SEGMENT_RETRIES = 5;
const RETRY_BASE_MS       = 500;
const HEAD_TIMEOUT_MS     = 10_000;
const PROGRESS_MIN_GAP    = UI.PROGRESS_INTERVAL;

export interface SegmentDescriptor {
  index: number;
  start: number;
  end: number;
  received: number;
  done: boolean;
}

interface ActiveRegistryEntry {
  controller: AbortController;
  segments: SegmentDescriptor[];
}

const _registry = new Map<string, ActiveRegistryEntry>();

export type ProgressCallback = (id: string, received: number, total: number, speedSnap: SpeedSnapshot) => void;
export type CompleteCallback = (id: string, result: DownloadResult, filename: string) => Promise<void> | void;
export type ErrorCallback = (id: string, errorMessage: string) => void;

interface ProgressState {
  received: number;
  total: number;
  lastBroadcast: number;
}

/**
 * Start (or resume) a download.
 */
export async function startDownload(
  download: DownloadItem,
  settings: ExtensionSettings,
  onProgress: ProgressCallback,
  onComplete: CompleteCallback,
  onError: ErrorCallback
): Promise<void> {
  _cancelExisting(download.id);

  const controller = new AbortController();
  _registry.set(download.id, { controller, segments: [] });

  try {
    const meta = await _probe(download.url, controller.signal);

    const totalSize     = meta.contentLength;
    const acceptsRanges = meta.acceptsRanges;
    const filename      = meta.filename || download.filename;

    const canChunk =
      acceptsRanges &&
      totalSize > 0 &&
      totalSize > settings.minChunkSizeMB * 1024 * 1024;

    const throttle = _makeThrottle(settings.speedLimitKBps || 0);

    const progress: ProgressState = {
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

    let result: DownloadResult;
    if (canChunk) {
      result = await _chunkedDownload({
        download, totalSize, settings, controller, throttle, progress, emit,
      });
    } else {
      result = await _singleDownload({
        download, controller, throttle, progress, emit,
      });
    }

    _registry.delete(download.id);

    const finalSize = progress.total || result.totalSize;
    tracker.record(finalSize, finalSize);
    onProgress(
      download.id,
      finalSize,
      finalSize,
      tracker.getSnapshot(),
    );

    await onComplete(download.id, result, filename);

  } catch (err: any) {
    _registry.delete(download.id);
    if (err?.name === 'AbortError') return;
    onError(download.id, err?.message || 'Unknown download error');
  }
}

export function pauseDownload(downloadId: string): void {
  const entry = _registry.get(downloadId);
  if (entry) {
    entry.controller.abort();
    _registry.delete(downloadId);
  }
}

export async function cancelDownload(downloadId: string): Promise<void> {
  pauseDownload(downloadId);
  await clearChunks(downloadId);
}

// ─────────────────────────────────────────────────────────────
//  HEAD Probe
// ─────────────────────────────────────────────────────────────

interface ProbeMeta {
  contentLength: number;
  acceptsRanges: boolean;
  filename: string | null;
}

async function _probe(url: string, signal: AbortSignal): Promise<ProbeMeta> {
  const headCtrl = new AbortController();
  const timer    = setTimeout(() => headCtrl.abort(), HEAD_TIMEOUT_MS);
  const combined = _combineSignals(signal, headCtrl.signal);

  let res: Response | null = null;
  try {
    res = await fetch(url, {
      method:      'HEAD',
      signal:      combined,
      credentials: 'include',
      redirect:    'follow',
    });
  } catch {
    try {
      res = await fetch(url, {
        method:      'GET',
        signal,
        headers:     { Range: 'bytes=0-0' },
        credentials: 'include',
        redirect:    'follow',
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
  const acceptsRanges = (res.headers.get('Accept-Ranges') || '').toLowerCase() === 'bytes';
  const filename      = _parseFilename(res, url);

  return { contentLength, acceptsRanges, filename };
}

// ─────────────────────────────────────────────────────────────
//  Single-Connection Download
// ─────────────────────────────────────────────────────────────

interface SingleDownloadParams {
  download: DownloadItem;
  controller: AbortController;
  throttle: (bytes: number) => Promise<void>;
  progress: ProgressState;
  emit: () => void;
}

async function _singleDownload({ download, controller, throttle, progress, emit }: SingleDownloadParams): Promise<DownloadResult> {
  const res = await fetch(download.url, {
    signal:      controller.signal,
    credentials: 'include',
    redirect:    'follow',
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  if (!res.body) throw new Error('Response body is null');

  const mimeType = res.headers.get('Content-Type') || 'application/octet-stream';
  const reader   = res.body.getReader();

  // Stream into IndexedDB in bounded 16 MB chunks so memory never exceeds 16 MB
  const PART_SIZE = 16 * 1024 * 1024;
  let currentPieces: Uint8Array[] = [];
  let currentBytes = 0;
  let chunkIndex = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      await throttle(value.byteLength);
      currentPieces.push(value);
      currentBytes      += value.byteLength;
      progress.received += value.byteLength;
      emit();

      if (currentBytes >= PART_SIZE) {
        const partBlob = new Blob(currentPieces as BlobPart[]);
        currentPieces  = [];
        currentBytes   = 0;
        await saveChunk(download.id, chunkIndex++, partBlob);
      }
    }
  }

  if (currentPieces.length > 0 || chunkIndex === 0) {
    const partBlob = new Blob(currentPieces as BlobPart[]);
    currentPieces  = [];
    await saveChunk(download.id, chunkIndex++, partBlob);
  }

  return {
    chunkCount: chunkIndex,
    totalSize: progress.received,
    mimeType,
  };
}

// ─────────────────────────────────────────────────────────────
//  Multi-Segment (Chunked) Download
// ─────────────────────────────────────────────────────────────

interface ChunkedDownloadParams {
  download: DownloadItem;
  totalSize: number;
  settings: ExtensionSettings;
  controller: AbortController;
  throttle: (bytes: number) => Promise<void>;
  progress: ProgressState;
  emit: () => void;
}

async function _chunkedDownload({ download, totalSize, settings, controller, throttle, progress, emit }: ChunkedDownloadParams): Promise<DownloadResult> {
  const numSegs = Math.max(
    1,
    Math.min(
      MAX_SEGMENTS,
      settings.maxChunks,
      Math.floor(totalSize / MIN_SEGMENT_BYTES),
    ),
  );

  const segSize  = Math.ceil(totalSize / numSegs);
  const segments: SegmentDescriptor[] = Array.from({ length: numSegs }, (_, i) => {
    const start = i * segSize;
    const end   = i === numSegs - 1 ? totalSize - 1 : start + segSize - 1;
    return { index: i, start, end, received: 0, done: false };
  });

  const entry = _registry.get(download.id);
  if (entry) entry.segments = segments;

  await Promise.all(
    segments.map(seg =>
      _fetchSegmentWithRetry({ download, seg, controller, throttle, progress, emit })
    )
  );

  progress.received = totalSize;
  emit();

  // All segments are stored in disk-backed IndexedDB Blobs.
  // Return metadata for zero-copy streaming assembly in offscreen document.
  return {
    chunkCount: segments.length,
    totalSize,
    mimeType: 'application/octet-stream',
  };
}

// ─────────────────────────────────────────────────────────────
//  Per-Segment Fetcher with Exponential Back-off + Jitter
// ─────────────────────────────────────────────────────────────

interface SegmentFetchParams {
  download: DownloadItem;
  seg: SegmentDescriptor;
  controller: AbortController;
  throttle: (bytes: number) => Promise<void>;
  progress: ProgressState;
  emit: () => void;
}

async function _fetchSegmentWithRetry({ download, seg, controller, throttle, progress, emit }: SegmentFetchParams): Promise<void> {
  const existing = await loadChunk(download.id, seg.index);
  if (existing) {
    seg.done      = true;
    const byteLength = (existing as any).size ?? (existing as any).byteLength ?? 0;
    seg.received  = byteLength;
    progress.received += byteLength;
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
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      attempt++;
      if (attempt >= MAX_SEGMENT_RETRIES) {
        throw new Error(`Segment ${seg.index} failed after ${attempt} retries: ${err.message}`);
      }
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) * (0.7 + Math.random() * 0.6);
      await _sleep(Math.min(delay, 30_000), controller.signal);

      progress.received -= seg.received;
      seg.received = 0;
    }
  }
}

async function _fetchSegmentOnce({ download, seg, controller, throttle, progress, emit }: SegmentFetchParams): Promise<void> {
  const res = await fetch(download.url, {
    signal:      controller.signal,
    credentials: 'include',
    redirect:    'follow',
    headers:     { Range: `bytes=${seg.start}-${seg.end}` },
  });

  if (!res.ok && res.status !== 206) {
    throw new Error(`HTTP ${res.status} for segment ${seg.index}`);
  }
  if (!res.body) throw new Error('Segment response body is null');

  const reader = res.body.getReader();
  const pieces: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (value) {
      await throttle(value.byteLength);
      pieces.push(value);
      seg.received      += value.byteLength;
      progress.received += value.byteLength;
      emit();
    }
  }

  // Zero-copy segment Blob creation & store directly to disk
  const segBlob = new Blob(pieces as BlobPart[]);
  pieces.length = 0; // immediate GC cleanup
  await saveChunk(download.id, seg.index, segBlob);
}

// ─────────────────────────────────────────────────────────────
//  Token-Bucket Rate Limiter
// ─────────────────────────────────────────────────────────────

function _makeThrottle(kbps: number): (bytes: number) => Promise<void> {
  if (!kbps || kbps <= 0) {
    return () => Promise.resolve();
  }

  const bytesPerSec = kbps * 1024;
  let   tokens      = bytesPerSec;
  let   lastRefill  = Date.now();
  const MAX_TOKENS  = bytesPerSec * 2;

  return function throttle(bytes: number): Promise<void> {
    const now     = Date.now();
    const elapsed = (now - lastRefill) / 1000;
    tokens        = Math.min(MAX_TOKENS, tokens + elapsed * bytesPerSec);
    lastRefill    = now;

    if (tokens >= bytes) {
      tokens -= bytes;
      return Promise.resolve();
    }

    const deficit = bytes - tokens;
    const waitMs  = (deficit / bytesPerSec) * 1000;
    tokens        = 0;
    return _sleep(waitMs);
  };
}

// ─────────────────────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────────────────────

function _sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function _parseContentLength(res: Response): number {
  const raw = res.headers.get('Content-Length');
  if (!raw) return 0;
  const n   = parseInt(raw, 10);
  return isFinite(n) && n > 0 ? n : 0;
}

function _parseFilename(res: Response, url: string): string {
  const cd = res.headers.get('Content-Disposition') || '';

  let m = cd.match(/filename\*\s*=\s*UTF-8''([^;\s]+)/i);
  if (m && m[1]) {
    try { return decodeURIComponent(m[1]); } catch { /* fall through */ }
  }

  m = cd.match(/filename\s*=\s*["']?([^;"'\n]+)["']?/i);
  if (m && m[1]) return m[1].trim();

  try {
    const u    = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const last = segs[segs.length - 1];
    if (last) return decodeURIComponent(last);
  } catch { /* ignore */ }

  return 'download';
}

function _cancelExisting(downloadId: string): void {
  const prev = _registry.get(downloadId);
  if (prev) {
    prev.controller.abort();
    _registry.delete(downloadId);
  }
}

function _combineSignals(s1: AbortSignal, s2: AbortSignal): AbortSignal {
  const ctrl  = new AbortController();
  const abort = () => ctrl.abort();
  s1.addEventListener('abort', abort, { once: true });
  s2.addEventListener('abort', abort, { once: true });
  return ctrl.signal;
}
