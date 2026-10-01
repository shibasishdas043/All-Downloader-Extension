// ============================================================
//  All-Downloader — Multi-Segment (Chunked) Parallel Download
// ============================================================
import { saveChunk } from '../storage.js';
import type { DownloadResult } from '../../shared/types.js';
import type { ChunkedDownloadParams, SegmentDescriptor, SegmentFetchParams } from './types.js';
import { getRegistryEntry } from './registry.js';
import { sleep } from './throttler.js';

export const MAX_SEGMENTS = 16;
export const MIN_SEGMENT_BYTES = 256 * 1024; // 256 KB
export const MAX_SEGMENT_RETRIES = 5;
export const RETRY_BASE_MS = 500;

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
  const numSegs = Math.max(
    1,
    Math.min(
      MAX_SEGMENTS,
      settings.maxChunks,
      Math.floor(totalSize / MIN_SEGMENT_BYTES),
    ),
  );

  const segSize = Math.ceil(totalSize / numSegs);
  const segments: SegmentDescriptor[] = Array.from({ length: numSegs }, (_, i) => {
    const start = i * segSize;
    const end = i === numSegs - 1 ? totalSize - 1 : start + segSize - 1;
    return { index: i, start, end, received: 0, done: false };
  });

  const entry = getRegistryEntry(download.id);
  if (entry) entry.segments = segments;

  await Promise.all(
    segments.map(seg =>
      fetchSegmentWithRetry({ download, seg, controller, throttle, progress, emit })
    )
  );

  progress.received = totalSize;
  emit();

  // All segments are stored in disk-backed IndexedDB Blobs.
  // Return metadata for zero-copy streaming assembly in offscreen document.
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
  const existing = await loadChunk(download.id, seg.index);
  if (existing) {
    seg.done = true;
    const byteLength = (existing as any).size ?? (existing as any).byteLength ?? 0;
    seg.received = byteLength;
    progress.received += byteLength;
    emit();
    return;
  }

  let attempt = 0;

  while (true) {
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      await fetchSegmentOnce({ download, seg, controller, throttle, progress, emit });
      seg.done = true;
      return;
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      attempt++;
      if (attempt >= MAX_SEGMENT_RETRIES) {
        throw new Error(`Segment ${seg.index} failed after ${attempt} retries: ${err.message}`);
      }
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) * (0.7 + Math.random() * 0.6);
      await sleep(Math.min(delay, 30_000), controller.signal);

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
  const res = await fetch(download.url, {
    signal: controller.signal,
    credentials: 'include',
    redirect: 'follow',
    headers: { Range: `bytes=${seg.start}-${seg.end}` },
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
      await throttle(value.byteLength, controller.signal);
      pieces.push(value);
      seg.received += value.byteLength;
      progress.received += value.byteLength;
      emit();
    }
  }

  // Zero-copy segment Blob creation & store directly to disk
  const segBlob = new Blob(pieces as BlobPart[]);
  pieces.length = 0; // immediate GC cleanup
  await saveChunk(download.id, seg.index, segBlob);
}
