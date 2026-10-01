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
  SegmentDescriptor,
} from './types.js';
import { probeUrl } from './probe.js';
import { createThrottle, type RateLimiter } from './throttler.js';
import { executeSingleDownload } from './single-download.js';
import { executeChunkedDownload } from './chunked-download.js';
import {
  cancelExistingDownload,
  setRegistryEntry,
  getRegistryEntry,
  deleteRegistryEntry,
} from './registry.js';
import { hostGovernor } from './host-governor.js';

export * from './types.js';
export * from './probe.js';
export * from './throttler.js';
export * from './registry.js';
export * from './single-download.js';
export * from './chunked-download.js';
export * from './host-governor.js';

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
  onMeta?: MetaCallback,
  rateLimiter?: RateLimiter | ((bytes: number, signal?: AbortSignal) => Promise<void>)
): Promise<void> {
  cancelExistingDownload(download.id);

  const controller = new AbortController();
  setRegistryEntry(download.id, { controller, segments: [] });
  hostGovernor.registerDownload(download.id, download.url);

  try {
    const meta = await probeUrl(download.url, controller.signal);

    const totalSize = meta.contentLength || download.filesize || 0;
    const acceptsRanges = meta.acceptsRanges;
    const filename = meta.filename || download.filename;
    const mimeType = meta.mimeType || download.mimeType || null;
    const etag = meta.etag || download.etag || null;
    const lastModified = meta.lastModified || download.lastModified || null;

    download.etag = etag;
    download.lastModified = lastModified;

    if (onMeta) {
      try {
        await onMeta({
          filename,
          mimeType,
          totalSize,
          hashExpected: meta.hashExpected,
          etag,
          lastModified,
          acceptsRanges,
        });
      } catch (err) {
        console.warn('[ADL] onMeta callback error:', err);
      }
    }

    const canChunk =
      acceptsRanges &&
      totalSize > 0 &&
      totalSize > settings.minChunkSizeMB * 1024 * 1024;

    const throttle = typeof rateLimiter === 'function'
      ? rateLimiter
      : rateLimiter
        ? (bytes: number, signal?: AbortSignal) => rateLimiter.acquire(bytes, signal)
        : createThrottle(settings.speedLimitKBps || 0);

    const progress: ProgressState = {
      received: 0,
      total: totalSize,
      lastBroadcast: 0,
    };
    const tracker = new SpeedTracker();

    const emit = (segs?: SegmentDescriptor[]) => {
      const now = Date.now();
      if (now - progress.lastBroadcast < PROGRESS_MIN_GAP) return;
      progress.lastBroadcast = now;
      tracker.record(progress.received, progress.total);
      onProgress(download.id, progress.received, progress.total, tracker.getSnapshot(), segs);
    };

    let result: DownloadResult;
    if (canChunk) {
      try {
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
      } catch (err: any) {
        if (err?.name === 'RangeNotSupportedError' || err?.message?.includes('RangeNotSupported')) {
          console.warn('[ADL] Server rejected byte range requests mid-stream. Falling back to single-stream download.');
          await clearChunks(download.id);
          progress.received = 0;
          emit();
          result = await executeSingleDownload({
            download,
            fallbackMime: mimeType || 'application/octet-stream',
            controller,
            throttle,
            progress,
            emit,
          });
        } else if (err?.name === 'ResourceModifiedError' || err?.message?.includes('ResourceModified')) {
          console.warn('[ADL] Resource modified on server mid-flight (ETag mismatch). Re-probing and restarting cleanly.');
          await clearChunks(download.id);
          progress.received = 0;
          emit();
          const freshMeta = await probeUrl(download.url, controller.signal);
          download.etag = freshMeta.etag;
          download.lastModified = freshMeta.lastModified;
          result = await executeChunkedDownload({
            download,
            totalSize: freshMeta.contentLength || totalSize,
            mimeType: freshMeta.mimeType || mimeType || 'application/octet-stream',
            settings,
            controller,
            throttle,
            progress,
            emit,
          });
        } else {
          throw err;
        }
      }
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
    hostGovernor.unregisterDownload(download.id, download.url);

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
    hostGovernor.unregisterDownload(download.id, download.url);
    if (err?.name === 'AbortError') return;
    onError(download.id, err?.message || 'Unknown download error');
  }
}

export function pauseDownload(downloadId: string): void {
  hostGovernor.unregisterDownload(downloadId);
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
