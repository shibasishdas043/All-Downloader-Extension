// ============================================================
//  All-Downloader — Multi-Segment (Chunked) Parallel Download
//  Industry-Grade Engine:
//  - Adaptive segmentation with bounded connection pool
//  - Constant O(1) memory buffering (sub-blob flushing)
//  - HTTP cache coherence (If-Range with ETag / Last-Modified)
//  - Resilient resume verification (byte-exact segment integrity)
//  - Graceful fallback detection (RangeNotSupportedError)
// ============================================================
import { saveChunk, loadChunk } from '../storage.js';
import type { DownloadResult } from '../../shared/types.js';
import type { ChunkedDownloadParams, SegmentDescriptor, SegmentFetchParams } from './types.js';
import { getRegistryEntry } from './registry.js';
import { sleep } from './throttler.js';
import { hostGovernor, HostConnectionGovernor, getNormalizedOrigin } from './host-governor.js';

export const MAX_SEGMENTS = 16;
export const MIN_SEGMENT_BYTES = 512 * 1024; // 512 KB minimum segment size
export const MAX_SEGMENT_RETRIES = 5;
export const RETRY_BASE_MS = 500;
export const MEMORY_FLUSH_THRESHOLD_BYTES = 4 * 1024 * 1024; // Flush to Blob every 4MB to keep JS heap near 0

export const READ_TIMEOUT_MS = 30_000; // 30s silence on stream = stall
export const STALL_MAX_RETRIES = 8; // per-segment stall retries
export const STALL_RETRY_BASE = 2_000; // exponential base 2s
export const STALL_CHECK_MS = 10_000; // watcher poll interval
export const STALL_THRESHOLD_MS = 45_000; // frozen segment threshold

export class StallError extends Error {
  constructor(
    public segmentIndex: number,
    public bytesAlreadyReceived: number,
  ) {
    super(`Segment ${segmentIndex} stalled — no bytes received for ${READ_TIMEOUT_MS / 1000}s`);
    this.name = 'StallError';
  }
}

export async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  parentSignal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    let timer: any = null;
    const onParentAbort = () => {
      if (timer) clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (parentSignal.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }

    timer = setTimeout(() => {
      parentSignal.removeEventListener('abort', onParentAbort);
      reject(new DOMException('Read stalled', 'TimeoutError'));
    }, timeoutMs);

    parentSignal.addEventListener('abort', onParentAbort, { once: true });

    reader.read().then(
      (result) => {
        if (timer) clearTimeout(timer);
        parentSignal.removeEventListener('abort', onParentAbort);
        resolve(result);
      },
      (err) => {
        if (timer) clearTimeout(timer);
        parentSignal.removeEventListener('abort', onParentAbort);
        reject(err);
      }
    );
  });
}

export class RangeNotSupportedError extends Error {
  constructor(message = 'Server does not support HTTP byte ranges') {
    super(message);
    this.name = 'RangeNotSupportedError';
  }
}

export class ResourceModifiedError extends Error {
  constructor(message = 'Resource modified on server during download (precondition failed)') {
    super(message);
    this.name = 'ResourceModifiedError';
  }
}

export async function executeChunkedDownload({
  download,
  totalSize,
  mimeType,
  settings,
  controller,
  throttle,
  progress,
  emit,
}: ChunkedDownloadParams): Promise<DownloadResult> {
  const origin = getNormalizedOrigin(download.url);
  const allocatedQuota = hostGovernor.getAllocatedQuota(download.id, download.url, settings.maxChunks || 8);
  const requestedChunks = Math.max(1, Math.min(MAX_SEGMENTS, settings.maxChunks || 8));
  const maxPossibleSegs = Math.max(1, Math.floor(totalSize / MIN_SEGMENT_BYTES));
  const numSegs = Math.max(1, Math.min(requestedChunks, maxPossibleSegs));

  const segSize = Math.ceil(totalSize / numSegs);
  const segments: SegmentDescriptor[] = Array.from({ length: numSegs }, (_, i) => {
    const start = i * segSize;
    const end = i === numSegs - 1 ? totalSize - 1 : start + segSize - 1;
    return { index: i, start, end, received: 0, done: false };
  });

  const entry = getRegistryEntry(download.id);
  if (entry) {
    entry.segments = segments;
  }

  // ── Upfront Storage Verification & Hydration Phase ──────────
  // Scan IndexedDB for existing completed chunks. Verify integrity and byte exactness.
  // Pre-hydrate progress.received and segment states so that upon resume:
  // 1. The total progress bar instantly reflects verified progress (e.g. 50%+).
  // 2. Verified segments are marked done and skipped by worker threads.
  // 3. UI thread cards and total progress bar are 100% in sync from the very first frame.
  let verifiedStoredBytes = 0;
  for (const seg of segments) {
    const expectedBytes = seg.end - seg.start + 1;
    try {
      const existing = await loadChunk(download.id, seg.index);
      if (existing) {
        const existingSize = (existing as any).size ?? (existing as any).byteLength ?? 0;
        if (existingSize === expectedBytes) {
          seg.done = true;
          seg.received = existingSize;
          verifiedStoredBytes += existingSize;
        }
      }
    } catch (e) {
      console.warn(`[ADL] Error verifying existing chunk ${seg.index}:`, e);
    }
  }

  progress.received = verifiedStoredBytes;
  emit(segments);

  // If all segments were already verified from storage, we are immediately done!
  if (segments.every((s) => s.done)) {
    return {
      chunkCount: segments.length,
      totalSize,
      mimeType: mimeType || 'application/octet-stream',
    };
  }

  let nextSegmentIndex = 0;
  let activeWorkers = 0;
  let hasError: Error | null = null;
  let resolveDone: (() => void) | null = null;

  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  async function poolWorker(): Promise<void> {
    activeWorkers++;
    try {
      while (nextSegmentIndex < segments.length) {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        // Elastic scaling: if origin quota decreased (sibling download started), yield excess worker gracefully
        const currentQuota = hostGovernor.getAllocatedQuota(download.id, download.url, settings.maxChunks || 8);
        if (activeWorkers > currentQuota && activeWorkers > 1) {
          break;
        }

        const segIndex = nextSegmentIndex++;
        if (segIndex >= segments.length) break;

        const seg = segments[segIndex];
        if (seg.done) {
          continue;
        }

        await fetchSegmentWithRetry({
          download,
          seg,
          controller,
          throttle,
          progress,
          emit: () => emit(segments),
        });

        // Elastic scaling: check if quota freed up to spawn additional workers
        maybeSpawnWorkers();
      }
    } catch (err: any) {
      if (!hasError && err?.name !== 'AbortError') {
        hasError = err;
      }
    } finally {
      activeWorkers--;
      if (activeWorkers === 0) {
        resolveDone?.();
      }
    }
  }

  function maybeSpawnWorkers(): void {
    if (controller.signal.aborted || hasError) return;
    const currentQuota = hostGovernor.getAllocatedQuota(download.id, download.url, settings.maxChunks || 8);
    while (activeWorkers < currentQuota && nextSegmentIndex < segments.length) {
      poolWorker();
    }
  }

  // Real-time subscription to origin quota changes for instant elastic scaling
  const unsubscribeQuota = hostGovernor.onQuotaChange(origin, () => {
    maybeSpawnWorkers();
  });

  // Dead-Segment Watcher: monitors byte progress of active segments
  const segLastProgress = new Map<number, { bytes: number; ts: number }>();
  const stallWatcher = setInterval(() => {
    if (controller.signal.aborted || hasError) return;
    const now = Date.now();
    for (const seg of segments) {
      if (seg.done) {
        segLastProgress.delete(seg.index);
        continue;
      }
      const snap = segLastProgress.get(seg.index);
      if (!snap || seg.received > snap.bytes) {
        segLastProgress.set(seg.index, { bytes: seg.received, ts: now });
      } else if (now - snap.ts > STALL_THRESHOLD_MS) {
        console.warn(`[ADL] Watcher: Segment ${seg.index} made no byte progress for >${STALL_THRESHOLD_MS / 1000}s`);
        segLastProgress.set(seg.index, { bytes: seg.received, ts: now });
      }
    }
  }, STALL_CHECK_MS);

  try {
    // Launch initial workers bounded by fair-share quota
    const initialConcurrency = Math.max(1, Math.min(segments.length, allocatedQuota));
    for (let i = 0; i < initialConcurrency; i++) {
      poolWorker();
    }

    await donePromise;

    if (hasError) {
      throw hasError;
    }
    if (controller.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
  } finally {
    clearInterval(stallWatcher);
    unsubscribeQuota();
  }

  progress.received = totalSize;
  for (const s of segments) {
    s.done = true;
    s.received = s.end - s.start + 1;
  }
  emit(segments);

  // All segments are securely committed in disk-backed IndexedDB Blobs.
  return {
    chunkCount: segments.length,
    totalSize,
    mimeType: mimeType || 'application/octet-stream',
  };
}

export async function fetchSegmentWithRetry({
  download,
  seg,
  controller,
  throttle,
  progress,
  emit,
}: SegmentFetchParams): Promise<void> {
  const expectedBytes = seg.end - seg.start + 1;

  // 1. Check if valid, non-corrupted chunk already exists in storage (resumability)
  if (!seg.done) {
    const existing = await loadChunk(download.id, seg.index);
    if (existing) {
      const existingSize = (existing as any).size ?? (existing as any).byteLength ?? 0;
      if (existingSize === expectedBytes) {
        seg.done = true;
        seg.received = existingSize;
        progress.received += existingSize;
        emit();
        return;
      }
    }
  } else {
    return;
  }

  let attempt = 0;
  let stallAttempts = 0;
  const blobParts: BlobPart[] = [];

  while (true) {
    if (controller.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      await fetchSegmentOnce({
        download,
        seg,
        controller,
        throttle,
        progress,
        emit,
        blobParts,
      });
      seg.done = true;
      return;
    } catch (err: any) {
      if (err.name === 'AbortError' || err instanceof RangeNotSupportedError || err instanceof ResourceModifiedError) {
        throw err;
      }

      if (err instanceof StallError || err?.name === 'TimeoutError') {
        stallAttempts++;
        if (stallAttempts >= STALL_MAX_RETRIES) {
          throw new Error(`Segment ${seg.index} stalled ${stallAttempts} times: network silence`);
        }
        // Sub-range resume: seg.received already holds bytes collected so far into blobParts!
        // Next attempt will request Range: bytes=(seg.start + seg.received)-(seg.end)
        const delay = STALL_RETRY_BASE * Math.pow(2, stallAttempts - 1) * (0.8 + Math.random() * 0.4);
        await sleep(Math.min(delay, 30_000), controller.signal);
        continue;
      }

      attempt++;
      if (attempt >= MAX_SEGMENT_RETRIES) {
        throw new Error(`Segment ${seg.index} failed after ${attempt} retries: ${err.message}`);
      }

      // Hard network error: reset segment progress for a clean retry
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) * (0.7 + Math.random() * 0.6);
      await sleep(Math.min(delay, 30_000), controller.signal);

      // Rollback received bytes for this segment before retry
      progress.received -= seg.received;
      seg.received = 0;
      blobParts.length = 0;
    }
  }
}

export async function fetchSegmentOnce({
  download,
  seg,
  controller,
  throttle,
  progress,
  emit,
  blobParts = [],
}: SegmentFetchParams & { blobParts?: BlobPart[] }): Promise<void> {
  const releaseSlot = await hostGovernor.acquireDataSlot(download.id, download.url, controller.signal);

  try {
    const currentOffset = seg.start + seg.received;
    if (currentOffset > seg.end) {
      // Already fully received
      return;
    }

    const headers: Record<string, string> = {
      Range: `bytes=${currentOffset}-${seg.end}`,
    };

    // HTTP Cache Coherence: send If-Range validator if available
    if (download.etag) {
      headers['If-Range'] = download.etag;
    } else if (download.lastModified) {
      headers['If-Range'] = download.lastModified;
    }

    const res = await fetch(download.url, {
      signal: controller.signal,
      credentials: 'include',
      redirect: 'follow',
      headers,
    });

    // Handle RFC 7232 precondition failed (file changed on server)
    if (res.status === 412) {
      throw new ResourceModifiedError(`Precondition failed (412) for segment ${seg.index}`);
    }

    const remainingExpected = seg.end - currentOffset + 1;
    // Handle server ignoring Range header
    if (res.status === 200) {
      const contentLength = parseInt(res.headers.get('Content-Length') || '0', 10);
      if (contentLength > remainingExpected || currentOffset > 0) {
        throw new RangeNotSupportedError(`Server returned HTTP 200 full response instead of 206 for segment ${seg.index}`);
      }
    } else if (!res.ok && res.status !== 206) {
      throw new Error(`HTTP ${res.status} for segment ${seg.index}`);
    }

    if (!res.body) {
      throw new Error(`Segment ${seg.index} response body is null`);
    }

    const reader = res.body.getReader();

    let currentBatch: Uint8Array[] = [];
    let currentBatchBytes = 0;

    try {
      while (true) {
        const { done, value } = await readWithTimeout(reader, READ_TIMEOUT_MS, controller.signal);
        if (done) break;

        if (value && value.byteLength > 0) {
          await throttle(value.byteLength, controller.signal);
          currentBatch.push(value);
          currentBatchBytes += value.byteLength;
          seg.received += value.byteLength;
          progress.received += value.byteLength;
          emit();

          if (currentBatchBytes >= MEMORY_FLUSH_THRESHOLD_BYTES) {
            blobParts.push(new Blob(currentBatch as BlobPart[]));
            currentBatch = [];
            currentBatchBytes = 0;
          }
        }
      }
    } catch (err: any) {
      if (currentBatch.length > 0) {
        blobParts.push(new Blob(currentBatch as BlobPart[]));
        currentBatch = [];
        currentBatchBytes = 0;
      }
      if (err?.name === 'TimeoutError') {
        throw new StallError(seg.index, seg.received);
      }
      throw err;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }

    if (currentBatch.length > 0) {
      blobParts.push(new Blob(currentBatch as BlobPart[]));
      currentBatch = [];
      currentBatchBytes = 0;
    }

    // Composite segment Blob stored directly in disk-backed IndexedDB
    const segBlob = new Blob(blobParts);
    blobParts.length = 0;

    await saveChunk(download.id, seg.index, segBlob);
  } finally {
    releaseSlot();
  }
}
