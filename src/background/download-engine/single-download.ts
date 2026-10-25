// ============================================================
//  All-Downloader — Single Connection Stream Download
// ============================================================
import { saveChunk } from '../storage.js';
import type { DownloadResult } from '../../shared/types.js';
import type { SingleDownloadParams } from './types.js';
import { hostGovernor } from './host-governor.js';

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
  const targetUrl = download.resolvedUrl || download.url;
  const releaseSlot = await hostGovernor.acquireDataSlot(download.id, targetUrl, controller.signal, 1);

  try {
    const headers: Record<string, string> = {};
    if (download.referrer) {
      headers['Referer'] = download.referrer;
    }

    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers,
      credentials: 'include',
      redirect: 'follow',
    });

    if (res.url && !download.resolvedUrl) {
      download.resolvedUrl = res.url;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
    if (!res.body) throw new Error('Response body is null');

    const clHdr = res.headers.get('Content-Length');
    if (clHdr) {
      const len = parseInt(clHdr, 10);
      if (isFinite(len) && len > 0) {
        progress.total = len;
        download.filesize = len;
        emit();
      }
    }

    const rawMime = res.headers.get('Content-Type') || '';
    const mimeType = rawMime.split(';')[0].trim().toLowerCase() || fallbackMime || 'application/octet-stream';

    // Prevent saving HTML pages when user intended to download media
    const isHtml = mimeType === 'text/html' || mimeType === 'application/xhtml+xml';
    const expectedCategory = download.category;
    if (isHtml && expectedCategory && ['video', 'audio', 'image', 'archive'].includes(expectedCategory)) {
      throw new Error(`Server returned a webpage (text/html) instead of the expected ${expectedCategory}. Direct media link may be protected or expired.`);
    }
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
  } finally {
    releaseSlot();
  }
}
