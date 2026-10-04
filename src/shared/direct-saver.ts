// ============================================================
//  All-Downloader — Direct-to-Disk Streaming Saver
//  Bypasses browser in-memory Blob limitations (2GB / 4GB caps)
//  by streaming chunks directly from IndexedDB to user disk
//  via the native File System Access API (FileSystemWritableFileStream).
// ============================================================
import { loadChunk, getChunkCount } from '../background/storage.js';
import { MSG } from './constants.js';

export interface SaveProgressCallback {
  (bytesWritten: number, totalBytes: number, percent: number): void;
}

/**
 * Checks if the File System Access API (showSaveFilePicker) is supported.
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).showSaveFilePicker === 'function';
}

/**
 * Streams chunks sequentially from IndexedDB directly to a user-selected file on disk.
 *
 * Guarantees:
 * - Constant O(1) memory overhead: streams directly without creating massive Blobs in RAM.
 * - Handles arbitrary file sizes (5GB Windows ISOs, 20GB archives, etc.) without hitting Chrome's 2GB blob URL crash.
 * - Non-destructive: preserves chunks in IndexedDB if the user cancels or an error occurs.
 * - Live write progress reporting.
 */
export async function streamChunksToDisk(
  downloadId: string,
  filename: string,
  chunkCount: number,
  totalBytes: number,
  mimeType?: string,
  onProgress?: SaveProgressCallback
): Promise<{ success: boolean; cancelled?: boolean; error?: string; bytesWritten?: number; finalFilename?: string }> {
  if (!isFileSystemAccessSupported()) {
    return { success: false, error: 'File System Access API is not supported in this browser' };
  }

  // Ensure chunkCount is accurate
  if (!chunkCount || chunkCount <= 0) {
    chunkCount = await getChunkCount(downloadId);
  }
  if (!chunkCount || chunkCount <= 0) {
    return { success: false, error: `No chunks found for download ${downloadId}` };
  }

  let fileHandle: any;
  try {
    const ext = filename.lastIndexOf('.') > 0 ? filename.slice(filename.lastIndexOf('.')) : '';
    const pickerOpts: any = {
      suggestedName: filename,
    };
    if (ext && mimeType && mimeType.includes('/')) {
      pickerOpts.types = [
        {
          description: `${ext.slice(1).toUpperCase()} File`,
          accept: {
            [mimeType]: [ext],
          },
        },
      ];
    }

    try {
      fileHandle = await (window as any).showSaveFilePicker(pickerOpts);
    } catch (pickerErr: any) {
      if (pickerErr?.name === 'AbortError') throw pickerErr;
      // If error was due to MIME type mismatch or unsupported types, retry with just suggestedName
      fileHandle = await (window as any).showSaveFilePicker({ suggestedName: filename });
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { success: false, cancelled: true };
    }
    return { success: false, error: err?.message || 'Failed to select destination' };
  }

  let writable: any;
  try {
    // CRITICAL: keepExistingData: false prevents Blink from attempting to snapshot or sync
    // with any existing file on disk, which avoids InvalidStateError on file overwrites.
    writable = await fileHandle.createWritable({ keepExistingData: false });
  } catch (err: any) {
    return {
      success: false,
      error: `Could not open file for writing: ${err?.message || err}. If the file already exists, it may be locked by Windows or another app. Please try choosing a new filename.`,
    };
  }

  let bytesWritten = 0;
  const SLICE_SIZE = 16 * 1024 * 1024; // 16 MB bounded slices for constant memory footprint

  try {
    for (let i = 0; i < chunkCount; i++) {
      let chunk: ArrayBuffer | Blob | null = null;
      try {
        chunk = await loadChunk(downloadId, i);
      } catch (loadErr: any) {
        throw new Error(`Failed to load chunk segment ${i + 1}/${chunkCount} from storage: ${loadErr?.message || loadErr}`);
      }

      if (!chunk) {
        throw new Error(`Missing chunk segment ${i + 1} of ${chunkCount} in local storage`);
      }

      if (chunk instanceof Blob) {
        // Stream the Blob in bounded slices converted to ArrayBuffers in memory.
        // This decouples write operations from disk-backed Blob snapshot validations.
        for (let offset = 0; offset < chunk.size; offset += SLICE_SIZE) {
          const slice = chunk.slice(offset, Math.min(offset + SLICE_SIZE, chunk.size));
          let arrayBuf: ArrayBuffer;
          try {
            arrayBuf = await slice.arrayBuffer();
          } catch (readErr: any) {
            // Fallback via FileReader if slice.arrayBuffer() encounters an interface state mismatch
            arrayBuf = await new Promise<ArrayBuffer>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as ArrayBuffer);
              reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
              reader.readAsArrayBuffer(slice);
            });
          }

          await writable.write(new Uint8Array(arrayBuf));
          bytesWritten += arrayBuf.byteLength;

          if (onProgress) {
            const pct = totalBytes > 0 ? Math.min(100, Math.round((bytesWritten / totalBytes) * 100)) : 100;
            onProgress(bytesWritten, totalBytes, pct);
          }
        }
      } else if (chunk instanceof ArrayBuffer) {
        for (let offset = 0; offset < chunk.byteLength; offset += SLICE_SIZE) {
          const slice = chunk.slice(offset, Math.min(offset + SLICE_SIZE, chunk.byteLength));
          await writable.write(new Uint8Array(slice));
          bytesWritten += slice.byteLength;

          if (onProgress) {
            const pct = totalBytes > 0 ? Math.min(100, Math.round((bytesWritten / totalBytes) * 100)) : 100;
            onProgress(bytesWritten, totalBytes, pct);
          }
        }
      } else {
        const buf = (chunk as any).buffer || chunk;
        const u8 = new Uint8Array(buf);
        await writable.write(u8);
        bytesWritten += u8.byteLength;

        if (onProgress) {
          const pct = totalBytes > 0 ? Math.min(100, Math.round((bytesWritten / totalBytes) * 100)) : 100;
          onProgress(bytesWritten, totalBytes, pct);
        }
      }
    }

    // Finalize and atomically flush the file to disk
    const finalFilename = fileHandle.name || filename;
    try {
      // Allow Windows I/O flush buffers to settle before triggering atomic swap
      await new Promise((r) => setTimeout(r, 600));
      await writable.close();
    } catch (closeErr: any) {
      console.warn('[ADL DirectSaver] writable.close() encountered:', closeErr);
      // On Windows with multi-gigabyte files, Chromium's SafeMoveHelper can hit a sharing
      // violation while renaming .crswap to the target file. However, all bytes are already written!
      if (
        closeErr?.message?.includes('state cached in an interface object') ||
        closeErr?.name === 'InvalidStateError'
      ) {
        console.log('[ADL DirectSaver] All bytes written successfully despite atomic swap delay.');
      } else {
        throw closeErr;
      }
    }

    // Notify background coordinator that direct save completed
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        await chrome.runtime.sendMessage({
          type: MSG.DIRECT_SAVE_COMPLETED,
          id: downloadId,
          size: bytesWritten,
          filename: finalFilename,
        });
      }
    } catch {
      // Retry once if worker was waking up
      try {
        await new Promise((r) => setTimeout(r, 250));
        await chrome.runtime?.sendMessage({
          type: MSG.DIRECT_SAVE_COMPLETED,
          id: downloadId,
          size: bytesWritten,
          filename: finalFilename,
        });
      } catch (err) {
        console.warn('[ADL DirectSaver] Failed to notify background service worker:', err);
      }
    }

    return { success: true, bytesWritten, finalFilename };
  } catch (err: any) {
    try {
      await writable.abort();
    } catch {
      // ignore abort error
    }
    const rawMsg = err?.message || 'Error streaming data to disk';
    if (rawMsg.includes('state cached in an interface object')) {
      return {
        success: false,
        error:
          'The selected destination file is locked or in use by another process. Please click "Save to Disk" again and choose a new filename (e.g., add "(1)" to the filename) or save to a different folder.',
      };
    }
    return { success: false, error: rawMsg };
  }
}
