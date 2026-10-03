// ============================================================
//  All-Downloader — Direct-to-Disk Streaming Saver
//  Bypasses browser in-memory Blob limitations (2GB / 4GB caps)
//  by streaming chunks directly from IndexedDB to user disk
//  via the native File System Access API (FileSystemWritableFileStream).
// ============================================================
import { loadChunk } from '../background/storage.js';
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

  let fileHandle: any;
  try {
    const ext = filename.lastIndexOf('.') > 0 ? filename.slice(filename.lastIndexOf('.')) : '';
    const pickerOpts: any = {
      suggestedName: filename,
    };
    if (ext) {
      pickerOpts.types = [
        {
          description: `${ext.slice(1).toUpperCase()} File`,
          accept: {
            [mimeType || 'application/octet-stream']: [ext],
          },
        },
      ];
    }
    fileHandle = await (window as any).showSaveFilePicker(pickerOpts);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { success: false, cancelled: true };
    }
    return { success: false, error: err?.message || 'Failed to select destination' };
  }

  let writable: any;
  try {
    writable = await fileHandle.createWritable();
  } catch (err: any) {
    return { success: false, error: `Could not open file for writing: ${err?.message || err}` };
  }

  let bytesWritten = 0;
  try {
    for (let i = 0; i < chunkCount; i++) {
      const chunk = await loadChunk(downloadId, i);
      if (!chunk) {
        throw new Error(`Missing chunk segment ${i} of ${chunkCount} in local storage`);
      }

      if (chunk instanceof Blob) {
        if (typeof chunk.stream === 'function') {
          await chunk.stream().pipeTo(writable, { preventClose: true });
        } else {
          await writable.write(chunk);
        }
        bytesWritten += chunk.size;
      } else if (chunk instanceof ArrayBuffer) {
        await writable.write(chunk);
        bytesWritten += chunk.byteLength;
      } else {
        await writable.write(chunk);
        bytesWritten += (chunk as any).size || (chunk as any).byteLength || 0;
      }

      if (onProgress) {
        const pct = totalBytes > 0 ? Math.min(100, Math.round((bytesWritten / totalBytes) * 100)) : 100;
        onProgress(bytesWritten, totalBytes, pct);
      }
    }

    await writable.close();

    const finalFilename = fileHandle.name || filename;

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
    return { success: false, error: err?.message || 'Error streaming data to disk' };
  }
}
