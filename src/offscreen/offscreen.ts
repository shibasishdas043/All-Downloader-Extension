// ============================================================
//  All-Downloader — Offscreen Document Script
//  Provides a DOM context for zero-copy Blob URL generation
//  and streaming assembly of multi-segment downloads
// ============================================================
import { MSG } from '../shared/constants.js';
import { loadAllChunks } from '../background/storage.js';
import { computeBlobSha256 } from '../shared/streaming-sha256.js';

interface ActiveBlobRecord {
  downloadId: string;
  created: number;
  blob: Blob;
  chunks: (ArrayBuffer | Blob)[];
}

const activeBlobUrls = new Map<string, ActiveBlobRecord>();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MSG.OFFSCREEN_CREATE_BLOB_URL) {
    handleCreateBlobUrl(message)
      .then((res) => sendResponse(res))
      .catch((err) => {
        console.error('[ADL Offscreen] Create Blob URL failed:', err);
        sendResponse({ success: false, error: err?.message || String(err) });
      });
    return true; // Keep message channel open for async response
  }

  if (message?.type === MSG.OFFSCREEN_DOWNLOAD_DIRECT) {
    handleDirectDownload(message)
      .then((res) => sendResponse(res))
      .catch((err) => {
        console.error('[ADL Offscreen] Direct download failed:', err);
        sendResponse({ success: false, error: err?.message || String(err) });
      });
    return true;
  }

  if (message?.type === MSG.OFFSCREEN_REVOKE_BLOB_URL) {
    if (message.blobUrl) {
      try {
        URL.revokeObjectURL(message.blobUrl);
        activeBlobUrls.delete(message.blobUrl);
      } catch (err) {
        console.warn('[ADL Offscreen] Revoke error:', err);
      }
    }
    sendResponse({ success: true });
    return false;
  }

  return false;
});

async function handleDirectDownload(params: {
  downloadId: string;
  chunkCount: number;
  filename: string;
  mimeType?: string;
}): Promise<{ success: boolean; blobUrl: string }> {
  const { downloadId, chunkCount, filename, mimeType } = params;
  const res = await handleCreateBlobUrl({ downloadId, chunkCount, mimeType, verifyHash: false });
  const a = document.createElement('a');
  a.href = res.blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return { success: true, blobUrl: res.blobUrl };
}

async function handleCreateBlobUrl(params: {
  downloadId: string;
  chunkCount: number;
  mimeType?: string;
  verifyHash?: boolean;
}): Promise<{ success: boolean; blobUrl: string; size: number; sha256?: string }> {
  const { downloadId, chunkCount, mimeType, verifyHash } = params;

  if (!downloadId || chunkCount <= 0) {
    throw new Error(`Invalid downloadId (${downloadId}) or chunkCount (${chunkCount})`);
  }

  // 1. Retrieve chunk Blobs directly from IndexedDB (disk-backed BLOB handles)
  const chunks = await loadAllChunks(downloadId, chunkCount);

  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i]) {
      throw new Error(`Missing segment ${i} for download ${downloadId}`);
    }
  }

  // 2. Construct composite Blob (Blink C++ creates zero-copy composite file reference)
  const compositeBlob = new Blob(chunks as BlobPart[], {
    type: mimeType || 'application/octet-stream',
  });

  // 3. Compute SHA-256 checksum if integrity verification is requested
  let sha256: string | undefined;
  if (verifyHash) {
    sha256 = await computeBlobSha256(compositeBlob);
  }

  // 4. Create native blob: URL
  const blobUrl = URL.createObjectURL(compositeBlob);
  activeBlobUrls.set(blobUrl, {
    downloadId,
    created: Date.now(),
    blob: compositeBlob,
    chunks,
  });

  return {
    success: true,
    blobUrl,
    size: compositeBlob.size,
    sha256,
  };
}
