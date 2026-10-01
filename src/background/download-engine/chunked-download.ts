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
    // Existing chunk was corrupted or incomplete (e.g. from an abrupt crash) — re-fetch it cleanly
  }

  let attempt = 0;

  while (true) {
    if (controller.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      await fetchSegmentOnce({ download, seg, controller, throttle, progress, emit });
      seg.done = true;
      return;
    } catch (err: any) {
      if (err.name === 'AbortError' || err instanceof RangeNotSupportedError || err instanceof ResourceModifiedError) {
        throw err;
      }
      attempt++;
      if (attempt >= MAX_SEGMENT_RETRIES) {
        throw new Error(`Segment ${seg.index} failed after ${attempt} retries: ${err.message}`);
      }

      // Exponential backoff with jitter
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) * (0.7 + Math.random() * 0.6);
      await sleep(Math.min(delay, 30_000), controller.signal);

      // Rollback received bytes for this segment before retry
      progress.received -= seg.received;
      seg.received = 0;
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
}: SegmentFetchParams): Promise<void> {
  const releaseSlot = await hostGovernor.acquireDataSlot(download.id, download.url, controller.signal);

  try {
    const headers: Record<string, string> = {
      Range: `bytes=${seg.start}-${seg.end}`,
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

    // Handle server ignoring Range header
    if (res.status === 200) {
      const expectedBytes = seg.end - seg.start + 1;
      const contentLength = parseInt(res.headers.get('Content-Length') || '0', 10);
      // If server sent full file instead of partial content
      if (contentLength > expectedBytes || seg.start > 0) {
        throw new RangeNotSupportedError(`Server returned HTTP 200 full response instead of 206 for segment ${seg.index}`);
      }
    } else if (!res.ok && res.status !== 206) {
      throw new Error(`HTTP ${res.status} for segment ${seg.index}`);
    }

    if (!res.body) {
      throw new Error(`Segment ${seg.index} response body is null`);
    }

    const reader = res.body.getReader();

    // Low-memory streaming: flush Uint8Array chunks into Blobs every MEMORY_FLUSH_THRESHOLD_BYTES
    // This allows V8 to immediately garbage-collect raw typed arrays, keeping JS heap under 10MB
    const blobParts: BlobPart[] = [];
    let currentBatch: Uint8Array[] = [];
    let currentBatchBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
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
