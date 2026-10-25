// ============================================================
//  All-Downloader — Offscreen Document Script
//  Provides a DOM context for zero-copy Blob URL generation
//  and streaming assembly of multi-segment downloads
// ============================================================
import { MSG } from '../shared/constants.js';
import { loadAllChunks } from '../background/storage.js';
import { computeBlobSha256 } from '../shared/streaming-sha256.js';
import mux from 'mux.js';

interface ActiveBlobRecord {
  downloadId: string;
  created: number;
  blob?: Blob;
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

  if (message?.type === MSG.OFFSCREEN_MUX_SEGMENTS) {
    handleMuxSegments(message)
      .then((res) => sendResponse(res))
      .catch((err) => {
        console.error('[ADL Offscreen] Mux segments failed:', err);
        sendResponse({ success: false, error: err?.message || String(err) });
      });
    return true;
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

  if (message?.type === MSG.OFFSCREEN_TRIGGER_CLICK) {
    try {
      const a = document.createElement('a');
      a.href = message.blobUrl;
      a.download = message.filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); } catch {}
      }, 200);
      sendResponse({ success: true });
    } catch (err: any) {
      console.error('[ADL Offscreen] Trigger click failed:', err);
      sendResponse({ success: false, error: err?.message || String(err) });
    }
    return false;
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
  blobUrl?: string;
}): Promise<{ success: boolean; blobUrl: string }> {
  const { downloadId, chunkCount, filename, mimeType } = params;
  let blobUrl = params.blobUrl;
  if (!blobUrl) {
    const res = await handleCreateBlobUrl({ downloadId, chunkCount, mimeType, verifyHash: false });
    blobUrl = res.blobUrl;
  }
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { document.body.removeChild(a); } catch {}
  }, 200);
  return { success: true, blobUrl };
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

  // Release chunk references immediately so GC can reclaim memory.
  // The composite Blob is a zero-copy view into the underlying storage;
  // holding the source arrays only wastes memory and causes FILE_TRANSIENT_ERROR
  // on large files (2+ GB) because the entire file stays pinned in the renderer.
  chunks.length = 0;

  // 3. Compute SHA-256 checksum if integrity verification is requested
  let sha256: string | undefined;
  if (verifyHash) {
    sha256 = await computeBlobSha256(compositeBlob);
  }

  // 4. Create native blob: URL
  // Retain compositeBlob in activeBlobUrls until explicit revocation (REVOKE_BLOB_URL)
  // to prevent premature GC invalidation of slice descriptors while Chrome streams to disk.
  const blobUrl = URL.createObjectURL(compositeBlob);
  activeBlobUrls.set(blobUrl, {
    downloadId,
    created: Date.now(),
    blob: compositeBlob,
  });

  const blobSize = compositeBlob.size;

  return {
    success: true,
    blobUrl,
    size: blobSize,
    sha256,
  };
}

async function handleMuxSegments(params: {
  downloadId: string;
  segmentCount: number;
  filename: string;
}): Promise<{ success: boolean; blobUrl: string; size: number }> {
  const { downloadId, segmentCount } = params;

  if (!downloadId || segmentCount <= 0) {
    throw new Error(`Invalid downloadId (${downloadId}) or segmentCount (${segmentCount})`);
  }

  const chunks = await loadAllChunks(downloadId, segmentCount);
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i]) {
      throw new Error(`Missing segment ${i} of ${segmentCount} for stream ${downloadId}`);
    }
  }

  let finalBlob: Blob;

  try {
    const transmuxer = new (mux as any).mp4.Transmuxer({
      remux: true,
      keepOriginalTimestamps: false,
    });

    const outputParts: Uint8Array[] = [];

    transmuxer.on('data', (segment: any) => {
      if (segment.initSegment && segment.initSegment.byteLength > 0) {
        outputParts.push(new Uint8Array(segment.initSegment));
      }
      if (segment.data && segment.data.byteLength > 0) {
        outputParts.push(new Uint8Array(segment.data));
      }
    });

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const buffer = c instanceof ArrayBuffer ? c : await (c as Blob).arrayBuffer();
      transmuxer.push(new Uint8Array(buffer));
      transmuxer.flush();
    }

    transmuxer.end();

    if (outputParts.length > 0) {
      finalBlob = new Blob(outputParts as BlobPart[], { type: 'video/mp4' });
    } else {
      finalBlob = new Blob(chunks as BlobPart[], { type: 'video/mp4' });
    }
  } catch (muxErr) {
    console.warn('[ADL Offscreen] mux.js transmuxing exception, falling back to direct concat:', muxErr);
    finalBlob = new Blob(chunks as BlobPart[], { type: 'video/mp4' });
  }

  chunks.length = 0;

  const blobUrl = URL.createObjectURL(finalBlob);
  activeBlobUrls.set(blobUrl, {
    downloadId,
    created: Date.now(),
    blob: finalBlob,
  });

  return {
    success: true,
    blobUrl,
    size: finalBlob.size,
  };
}

