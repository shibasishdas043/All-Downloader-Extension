// ============================================================
//  All-Downloader — Offscreen Document Script
//  Provides a DOM context for zero-copy Blob URL generation
//  and streaming assembly of multi-segment downloads
// ============================================================
import { MSG } from '../shared/constants.js';
import { loadAllChunks } from '../background/storage.js';

const activeBlobUrls = new Map<string, { downloadId: string; created: number }>();

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
    const arrayBuffer = await compositeBlob.arrayBuffer();
    const digestBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    sha256 = Array.from(new Uint8Array(digestBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // 4. Create native blob: URL
  const blobUrl = URL.createObjectURL(compositeBlob);
  activeBlobUrls.set(blobUrl, { downloadId, created: Date.now() });

  return {
    success: true,
    blobUrl,
    size: compositeBlob.size,
    sha256,
  };
}
