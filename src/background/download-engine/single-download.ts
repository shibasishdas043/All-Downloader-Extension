// ============================================================
//  All-Downloader — Single Connection Stream Download
// ============================================================
import { saveChunk } from '../storage.js';
import type { DownloadResult } from '../../shared/types.js';
import type { SingleDownloadParams } from './types.js';

/**
 * Downloads a resource over a single HTTP connection, streaming chunks into IndexedDB
 * in bounded 16 MB chunks so memory never spikes.
 */
export async function executeSingleDownload({
  download,
  fallbackMime,
  controller,
  throttle,
  progress,
  emit,
}: SingleDownloadParams): Promise<DownloadResult> {
  const res = await fetch(download.url, {
    signal: controller.signal,
    credentials: 'include',
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  if (!res.body) throw new Error('Response body is null');

  const rawMime = res.headers.get('Content-Type') || '';
  const mimeType = rawMime.split(';')[0].trim().toLowerCase() || fallbackMime || 'application/octet-stream';
  const reader = res.body.getReader();

  // Stream into IndexedDB in bounded 16 MB chunks so memory never exceeds 16 MB
  const PART_SIZE = 16 * 1024 * 1024;
  let currentPieces: Uint8Array[] = [];
  let currentBytes = 0;
  let chunkIndex = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      await throttle(value.byteLength, controller.signal);
      currentPieces.push(value);
      currentBytes += value.byteLength;
      progress.received += value.byteLength;
      emit();

      if (currentBytes >= PART_SIZE) {
        const partBlob = new Blob(currentPieces as BlobPart[]);
        currentPieces = [];
        currentBytes = 0;
        await saveChunk(download.id, chunkIndex++, partBlob);
      }
    }
  }

  if (currentPieces.length > 0 || chunkIndex === 0) {
    const partBlob = new Blob(currentPieces as BlobPart[]);
    currentPieces = [];
    await saveChunk(download.id, chunkIndex++, partBlob);
  }

  return {
    chunkCount: chunkIndex,
    totalSize: progress.received,
    mimeType,
  };
}
