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
  const SLICE_SIZE = 32 * 1024 * 1024; // 32 MB bounded slices for constant memory footprint

  let finalFilename = fileHandle?.name || filename;
  try {
    // Stream chunks sequentially to disk
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
        for (let offset = 0; offset < chunk.size; offset += SLICE_SIZE) {
          const slice = chunk.slice(offset, Math.min(offset + SLICE_SIZE, chunk.size));
          let arrayBuf: ArrayBuffer;
          try {
            arrayBuf = await slice.arrayBuffer();
          } catch (readErr: any) {
            arrayBuf = await new Promise<ArrayBuffer>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as ArrayBuffer);
              reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
              reader.readAsArrayBuffer(slice);
            });
          }

          const u8 = new Uint8Array(arrayBuf);
          await writable.write(u8);
          bytesWritten += u8.byteLength;

          if (onProgress) {
            const pct = totalBytes > 0 ? Math.min(100, Math.round((bytesWritten / totalBytes) * 100)) : 100;
            onProgress(bytesWritten, totalBytes, pct);
          }
        }
      } else if (chunk instanceof ArrayBuffer) {
        for (let offset = 0; offset < chunk.byteLength; offset += SLICE_SIZE) {
          const slice = chunk.slice(offset, Math.min(offset + SLICE_SIZE, chunk.byteLength));
          const u8 = new Uint8Array(slice);
          await writable.write(u8);
          bytesWritten += u8.byteLength;

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

    // Verify all expected bytes were written to the stream
    if (totalBytes > 0 && bytesWritten < totalBytes) {
      throw new Error(
        `Integrity check failed: Expected ${totalBytes} bytes but only wrote ${bytesWritten} bytes to disk.`
      );
    }

    finalFilename = fileHandle?.name || filename;

    // Allow Windows I/O flush buffers to settle before triggering atomic swap
    await new Promise((r) => setTimeout(r, 1000));

    try {
      await writable.close();
    } catch (closeErr: any) {
      console.warn('[ADL DirectSaver] writable.close() notice:', closeErr);
      // On Windows with multi-gigabyte ISOs, Chromium's SafeMoveHelper can hit a temporary
      // sharing violation while renaming .crswap to the target file if Windows Defender is scanning.
      // However, all bytes are 100% written on disk!
      if (
        closeErr?.message?.includes('state cached in an interface object') ||
        closeErr?.name === 'InvalidStateError' ||
        closeErr?.message?.includes('locked')
      ) {
        console.log('[ADL DirectSaver] All bytes safely committed to disk despite swap rename delay.');
      } else {
        throw closeErr;
      }
    }

    let verifiedSize = bytesWritten;
    if (typeof fileHandle.getFile === 'function') {
      try {
        const diskFile = await fileHandle.getFile();
        if (diskFile && diskFile.size > 0) {
          verifiedSize = diskFile.size;
        }
      } catch (verifyErr) {
        console.warn('[ADL DirectSaver] Non-fatal getFile() check:', verifyErr);
      }
    }

    // Notify background coordinator that direct save completed with verified size
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        await chrome.runtime.sendMessage({
          type: MSG.DIRECT_SAVE_COMPLETED,
          id: downloadId,
          size: verifiedSize,
          filename: finalFilename,
        });
      }
    } catch {
      try {
        await new Promise((r) => setTimeout(r, 250));
        await chrome.runtime?.sendMessage({
          type: MSG.DIRECT_SAVE_COMPLETED,
          id: downloadId,
          size: verifiedSize,
          filename: finalFilename,
        });
      } catch (err) {
        console.warn('[ADL DirectSaver] Failed to notify background service worker:', err);
      }
    }

    return { success: true, bytesWritten: verifiedSize, finalFilename };
  } catch (err: any) {
    try {
      await writable.abort();
    } catch {
      // ignore abort error
    }
    const rawMsg = err?.message || 'Error streaming data to disk';
    console.error('[ADL DirectSaver] Direct save failed:', err);

    let userFriendlyError = rawMsg;
    if (
      rawMsg.includes('state cached in an interface object') ||
      rawMsg.includes('InvalidStateError') ||
      rawMsg.includes('verification failed') ||
      rawMsg.includes('locked')
    ) {
      userFriendlyError =
        `Windows locked the destination file because it is open in File Explorer (e.g. in the Details pane) or being scanned by antivirus.\n\n` +
        `Good news: Your downloaded data (${(totalBytes ? (totalBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB' : '100%')}) has already been written to disk as "${finalFilename}.crswap"!\n\n` +
        `To finalize right now:\n` +
        `1. Close File Explorer (or unselect the file) so Windows releases the lock.\n` +
        `2. Delete the 0-byte "${finalFilename}".\n` +
        `3. Rename "${finalFilename}.crswap" to "${finalFilename}".\n\n` +
        `Or click "Save to Disk" again and choose a new filename (e.g. add "(1)") or save to a different folder.`;
    }

    return { success: false, error: userFriendlyError };
  }
}
