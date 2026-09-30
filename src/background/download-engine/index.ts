// ============================================================
//  All-Downloader — Download Engine Main Controller
// ============================================================
import { UI } from '../../shared/constants.js';
import { SpeedTracker } from '../speed-tracker.js';
import { clearChunks } from '../storage.js';
import type { DownloadItem, ExtensionSettings, DownloadResult } from '../../shared/types.js';
import type {
  ProgressCallback,
  CompleteCallback,
  ErrorCallback,
  MetaCallback,
  ProgressState,
} from './types.js';
import { probeUrl } from './probe.js';
import { createThrottle } from './throttler.js';
import { executeSingleDownload } from './single-download.js';
import { executeChunkedDownload } from './chunked-download.js';
import {
  cancelExistingDownload,
  setRegistryEntry,
  getRegistryEntry,
  deleteRegistryEntry,
} from './registry.js';

export * from './types.js';
export * from './probe.js';
export * from './throttler.js';
export * from './registry.js';
export * from './single-download.js';
export * from './chunked-download.js';

const PROGRESS_MIN_GAP = UI.PROGRESS_INTERVAL;

/**
 * Start (or resume) a download.
 */
export async function startDownload(
  download: DownloadItem,
  settings: ExtensionSettings,
  onProgress: ProgressCallback,
  onComplete: CompleteCallback,
  onError: ErrorCallback,
  onMeta?: MetaCallback
): Promise<void> {
  cancelExistingDownload(download.id);

  const controller = new AbortController();
  setRegistryEntry(download.id, { controller, segments: [] });

  try {
    const meta = await probeUrl(download.url, controller.signal);

    const totalSize = meta.contentLength;
    const acceptsRanges = meta.acceptsRanges;
    const filename = meta.filename || download.filename;
    const mimeType = meta.mimeType || download.mimeType || null;

    if (onMeta) {
      try {
        await onMeta({ filename, mimeType, totalSize, hashExpected: meta.hashExpected });
      } catch (err) {
        console.warn('[ADL] onMeta callback error:', err);
      }
    }

    const canChunk =
      acceptsRanges &&
      totalSize > 0 &&
      totalSize > settings.minChunkSizeMB * 1024 * 1024;

    const throttle = createThrottle(settings.speedLimitKBps || 0);

    const progress: ProgressState = {
      received: 0,
      total: totalSize,
      lastBroadcast: 0,
    };
    const tracker = new SpeedTracker();

    const emit = () => {
      const now = Date.now();
      if (now - progress.lastBroadcast < PROGRESS_MIN_GAP) return;
      progress.lastBroadcast = now;
      tracker.record(progress.received, progress.total);
      onProgress(download.id, progress.received, progress.total, tracker.getSnapshot());
    };

    let result: DownloadResult;
    if (canChunk) {
      result = await executeChunkedDownload({
        download,
        totalSize,
        mimeType: mimeType || 'application/octet-stream',
        settings,
        controller,
        throttle,
        progress,
        emit,
      });
    } else {
      result = await executeSingleDownload({
        download,
        fallbackMime: mimeType || 'application/octet-stream',
        controller,
        throttle,
        progress,
        emit,
      });
    }

    deleteRegistryEntry(download.id);

    const finalSize = progress.total || result.totalSize;
    tracker.record(finalSize, finalSize);
    onProgress(
      download.id,
      finalSize,
      finalSize,
      tracker.getSnapshot(),
    );

    await onComplete(download.id, result, filename);

  } catch (err: any) {
    deleteRegistryEntry(download.id);
    if (err?.name === 'AbortError') return;
    onError(download.id, err?.message || 'Unknown download error');
  }
}

export function pauseDownload(downloadId: string): void {
  const entry = getRegistryEntry(downloadId);
  if (entry) {
    entry.controller.abort();
    deleteRegistryEntry(downloadId);
  }
}

export async function cancelDownload(downloadId: string): Promise<void> {
  pauseDownload(downloadId);
  await clearChunks(downloadId);
}
