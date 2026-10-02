// ============================================================
//  All-Downloader — Download Coordinator Service
// ============================================================
import { MSG, DOWNLOAD_STATE, CATEGORY_FOLDER_NAMES, HEAVY_EXTENSIONS } from '../../shared/constants.js';
import {
  generateId, getFilenameFromUrl, detectCategory,
  calcPercent
} from '../../shared/utils.js';
import {
  upsertDownload, getDownload,
  loadDownloads, saveDownloads, recordCompletion, clearChunks
} from '../storage.js';
import { startDownload, pauseDownload, cancelDownload, RateLimiter } from '../download-engine.js';
import { QueueManager } from '../queue-manager.js';
import type { DownloadItem, ExtensionSettings, DownloadState } from '../../shared/types.js';
import { sanitizeFilename, buildSavePath, escapeRegex } from './path-sanitizer.js';
import { updateBadge, broadcastMessage, showNotification } from './badge-manager.js';
import {
  ensureOffscreenDocument, closeOffscreenDocumentIfIdle,
  cleanupPendingChromeDownload, revokeBlobUrl,
  retainOffscreenAssembly, releaseOffscreenAssembly,
  type PendingChromeDownload
} from './offscreen-manager.js';
import { showDownloadStartedToast } from './toast-manager.js';
import { RightClickDetector, urlsMatch, getFilename } from './right-click-detector.js';

export function isHeavyDownload(item: chrome.downloads.DownloadItem): boolean {
  const urlOrFn = item.filename || item.url || '';
  try {
    const url = new URL(urlOrFn, 'https://example.com');
    const pathname = url.pathname;
    const lastDot = pathname.lastIndexOf('.');
    if (lastDot > 0 && lastDot < pathname.length - 1) {
      const ext = pathname.substring(lastDot + 1).toLowerCase();
      if (HEAVY_EXTENSIONS.has(ext)) return true;
    }
  } catch {
    const lastDot = urlOrFn.lastIndexOf('.');
    if (lastDot > 0 && lastDot < urlOrFn.length - 1) {
      const ext = urlOrFn.substring(lastDot + 1).split(/[?#]/)[0].toLowerCase();
      if (HEAVY_EXTENSIONS.has(ext)) return true;
    }
  }

  // Check MIME type if available
  const mime = (item.mime || '').toLowerCase();
  if (
    mime.includes('zip') ||
    mime.includes('tar') ||
    mime.includes('compressed') ||
    mime.includes('archive') ||
    mime.includes('iso') ||
    mime.includes('diskimage') ||
    (mime.includes('octet-stream') && (urlOrFn.includes('.iso') || urlOrFn.includes('.bin') || urlOrFn.includes('.zip'))) ||
    mime.startsWith('video/')
  ) {
    return true;
  }

  return false;
}

export interface AddDownloadOptions {
  url: string;
  filename?: string;
  referrer?: string;
  mimeType?: string;
  scheduledAt?: number | null;
}

export class DownloadCoordinator {
  public settings: ExtensionSettings;
  public downloadCache = new Map<string, DownloadItem>();
  public pendingChromeDownloads = new Map<number, PendingChromeDownload>();
  public pendingBlobSaves = new Map<string, { id: string; targetSavePath: string; safeFilename: string; fileSize: number }>();
  public ownBlobUrls = new Set<string>();
  public rightClickDetector = new RightClickDetector();
  public queue: QueueManager;
  public rateLimiter: RateLimiter;

  constructor(settings: ExtensionSettings) {
    this.settings = settings;
    this.rateLimiter = new RateLimiter(settings.speedLimitKBps || 0);
    this.queue = new QueueManager({
      maxConcurrent: settings.maxConcurrent,
      onDequeue: (downloadId: string) => {
        this.executeDownload(downloadId);
      },
    });
  }

  public updateSettings(newSettings: ExtensionSettings): void {
    this.settings = newSettings;
    this.queue.setMaxConcurrent(newSettings.maxConcurrent);
    this.rateLimiter.setRate(newSettings.speedLimitKBps || 0);
  }

  public async updateState(
    id: string,
    state: DownloadState,
    extra: Record<string, any> = {}
  ): Promise<DownloadItem> {
    const dl = this.downloadCache.get(id) || await getDownload(id) || {} as any;
    const currentStatus = (dl.status || dl.state) as DownloadState | undefined;

    // Strict State Transition Guard:
    // Prevent stale in-flight events (progress, meta, late merge callbacks) from reviving
    // terminal or paused downloads back into active downloading/connecting states.
    if (currentStatus) {
      if (currentStatus === DOWNLOAD_STATE.CANCELLED) {
        // A cancelled download can ONLY be revived by an explicit user RETRY (which sets QUEUED or CONNECTING with 0 bytes/percent)
        // Stale events, QUEUED transitions, or active states MUST be strictly rejected.
        const isUserRevival = (state === DOWNLOAD_STATE.QUEUED || state === DOWNLOAD_STATE.CONNECTING) &&
          extra.receivedBytes === 0 &&
          extra.percent === 0;
        if (state !== DOWNLOAD_STATE.CANCELLED && !isUserRevival) {
          return dl;
        }
      } else if (currentStatus === DOWNLOAD_STATE.COMPLETED) {
        // A completed download cannot transition to active or queued states unless explicitly re-tried
        const isUserRetry = (state === DOWNLOAD_STATE.QUEUED || state === DOWNLOAD_STATE.CONNECTING) &&
          extra.receivedBytes === 0 &&
          extra.percent === 0;
        if (state !== DOWNLOAD_STATE.COMPLETED && !isUserRetry) {
          return dl;
        }
      } else if (currentStatus === DOWNLOAD_STATE.PAUSED) {
        // A paused download can only become CONNECTING or QUEUED (via explicit user RESUME/RETRY) or CANCELLED/ERROR
        const activeStates: DownloadState[] = [
          DOWNLOAD_STATE.DOWNLOADING as DownloadState,
          DOWNLOAD_STATE.MERGING as DownloadState,
          DOWNLOAD_STATE.VERIFYING as DownloadState,
        ];
        if (activeStates.includes(state)) {
          return dl;
        }
      }
    }

    const updated: DownloadItem = {
      ...dl,
      id,
      status: state,
      state,
      ...extra,
    };
    this.downloadCache.set(id, updated);
    await upsertDownload(updated);
    updateBadge(this.downloadCache.values());
    return updated;
  }

  public async addDownload({
    url,
    filename,
    referrer = '',
    mimeType,
    scheduledAt = null,
  }: AddDownloadOptions): Promise<DownloadItem> {
    const id = generateId();
    const name = filename || getFilenameFromUrl(url);
    const detectedCategory = detectCategory(name, mimeType);
    const download: DownloadItem = {
      id,
      url,
      filename: name,
      category: detectedCategory,
      mimeType: mimeType || null,
      filesize: 0,
      receivedBytes: 0,
      progress: 0,
      speed: 0,
      eta: null,
      status: DOWNLOAD_STATE.QUEUED as DownloadState,
      createdAt: Date.now(),
      errorMessage: null,
      error: null,
      scheduledTime: scheduledAt,
      ...( {
        referrer,
        state: DOWNLOAD_STATE.QUEUED,
        total: 0,
        received: 0,
        percent: 0,
        startedAt: null,
        completedAt: null,
        scheduledAt,
        chunked: false,
        hash: null,
      } as any )
    };

    await upsertDownload(download);
    this.downloadCache.set(id, download);

    broadcastMessage({ type: MSG.DOWNLOAD_ADDED, download });
    updateBadge(this.downloadCache.values());
    showDownloadStartedToast(name);

    if (this.settings.autoStart) {
      this.queue.enqueue(id, scheduledAt);
    }

    return download;
  }

  public async executeDownload(downloadId: string): Promise<void> {
    const dl = await getDownload(downloadId);
    if (!dl) { this.queue.markDone(downloadId); return; }

    const st = dl.status || (dl as any).state;
    if (st === DOWNLOAD_STATE.CANCELLED || st === DOWNLOAD_STATE.PAUSED || st === DOWNLOAD_STATE.COMPLETED) {
      this.queue.markDone(downloadId);
      return;
    }

    // If chunks are already 100% downloaded in local storage and waiting to be saved to disk
    if ((dl as any).isReadyToSave && (dl.filesize || dl.receivedBytes)) {
      await this.saveExistingDownloadToDisk(dl);
      return;
    }

    await this.updateState(downloadId, DOWNLOAD_STATE.CONNECTING as DownloadState, { startedAt: Date.now() });
    broadcastMessage({
      type: MSG.DOWNLOAD_PROGRESS,
      id: downloadId,
      state: DOWNLOAD_STATE.CONNECTING,
      speed: 0,
    });

    await startDownload(
      dl,
      this.settings,
      async (id, received, total, speedSnap, segments) => {
        const cur = this.downloadCache.get(id);
        const curStatus = (cur?.status || (cur as any)?.state);
        if (
          curStatus === DOWNLOAD_STATE.CANCELLED ||
          curStatus === DOWNLOAD_STATE.PAUSED ||
          curStatus === DOWNLOAD_STATE.COMPLETED ||
          curStatus === DOWNLOAD_STATE.ERROR
        ) {
          return;
        }

        const percent = calcPercent(received, total);
        const update: Record<string, any> = {
          state: DOWNLOAD_STATE.DOWNLOADING,
          status: DOWNLOAD_STATE.DOWNLOADING as DownloadState,
          received,
          receivedBytes: received,
          total,
          filesize: total,
          percent,
          progress: percent,
          speed: speedSnap.bytesPerSec,
          eta: speedSnap.etaSec,
        };
        if (segments && segments.length > 0) {
          update.segments = segments;
          update.totalChunks = segments.length;
          dl.segments = segments;
          dl.totalChunks = segments.length;
        }
        await this.updateState(id, DOWNLOAD_STATE.DOWNLOADING as DownloadState, update);
        broadcastMessage({ type: MSG.DOWNLOAD_PROGRESS, id, ...update });
      },
      async (id, result, finalFilename) => {
        const cur = this.downloadCache.get(id);
        const curStatus = (cur?.status || (cur as any)?.state);
        if (
          curStatus === DOWNLOAD_STATE.CANCELLED ||
          curStatus === DOWNLOAD_STATE.PAUSED ||
          curStatus === DOWNLOAD_STATE.COMPLETED
        ) {
          return;
        }

        try {
          const actualSize = result.totalSize || (dl as any).filesize || (dl as any).total || 0;
          const shouldVerify = Boolean(this.settings.verifyIntegrity);
          if (shouldVerify) {
            await this.updateState(id, DOWNLOAD_STATE.VERIFYING as DownloadState, {
              total: actualSize,
              filesize: actualSize,
              received: actualSize,
              receivedBytes: actualSize,
            });
            broadcastMessage({
              type: MSG.DOWNLOAD_PROGRESS,
              id,
              state: DOWNLOAD_STATE.VERIFYING,
              total: actualSize,
              filesize: actualSize,
              received: actualSize,
              receivedBytes: actualSize,
            });
          } else {
            await this.updateState(id, DOWNLOAD_STATE.MERGING as DownloadState, {
              total: actualSize,
              filesize: actualSize,
              received: actualSize,
              receivedBytes: actualSize,
            });
          }

          const safeFilename = sanitizeFilename(finalFilename);
          const resolvedMime = result.mimeType || dl.mimeType || null;
          const resolvedCategory = detectCategory(safeFilename, resolvedMime);
          const categoryFolder = this.settings.organizeByCategoryFolders
            ? (CATEGORY_FOLDER_NAMES[resolvedCategory] || undefined)
            : undefined;
          const savePath = buildSavePath(this.settings.defaultSavePath, safeFilename, categoryFolder);

          // 1. Ensure Offscreen Document is active and retain assembly slot
          retainOffscreenAssembly();
          let response: any;
          try {
            await ensureOffscreenDocument();

            // 2. Request Offscreen Document to create Blob URL from IndexedDB chunks (and compute hash if requested)
            response = await chrome.runtime.sendMessage({
              type: MSG.OFFSCREEN_CREATE_BLOB_URL,
              downloadId: id,
              chunkCount: result.chunkCount,
              mimeType: result.mimeType,
              verifyHash: shouldVerify,
            });
          } finally {
            releaseOffscreenAssembly();
          }

          if (!response || !response.success || !response.blobUrl) {
            throw new Error(response?.error || 'Failed to assemble download chunks in offscreen document');
          }

          const actualHash = response.sha256 || null;
          const currentDl = this.downloadCache.get(id) || dl;
          const expectedHash = currentDl.hashExpected || null;
          let verified: boolean | null = null;

          if (actualHash) {
            if (expectedHash) {
              verified = actualHash.toLowerCase() === expectedHash.toLowerCase();
              if (!verified) {
                throw new Error(`Integrity check failed: SHA-256 mismatch (expected ${expectedHash}, got ${actualHash})`);
              }
            } else {
              verified = true;
            }
          }

          const blobUrl = response.blobUrl;
          this.ownBlobUrls.add(blobUrl);
          this.pendingBlobSaves.set(blobUrl, {
            id,
            targetSavePath: savePath,
            safeFilename,
            fileSize: actualSize,
          });

          // Update with final MIME type, category, integrity verification, verified file size, and total chunks
          await this.updateState(id, DOWNLOAD_STATE.MERGING as DownloadState, {
            category: resolvedCategory,
            mimeType: resolvedMime,
            hashActual: actualHash,
            hashVerified: verified,
            total: actualSize,
            filesize: actualSize,
            received: actualSize,
            receivedBytes: actualSize,
            totalChunks: result.chunkCount,
            chunkCount: result.chunkCount,
            savePath,
          });

          // 3. Initiate native Chrome streaming download to user disk
          chrome.downloads.download(
            {
              url: blobUrl,
              filename: savePath,
              saveAs: false,
              conflictAction: 'uniquify',
            },
            (chromeDlId) => {
              if (chrome.runtime.lastError || !chromeDlId) {
                const err = chrome.runtime.lastError?.message || 'Chrome download API rejected request';
                console.error('[ADL] save error:', err);
                this.pendingBlobSaves.delete(blobUrl);
                revokeBlobUrl(blobUrl);
                this.updateState(id, DOWNLOAD_STATE.ERROR as DownloadState, {
                  error: `Save failed: ${err} — click Retry`,
                  errorMessage: `Save failed: ${err} — click Retry`,
                });
                this.queue.markDone(id);
                broadcastMessage({ type: MSG.DOWNLOAD_ERROR, id, error: err });
                return;
              }

              this.pendingChromeDownloads.set(chromeDlId, {
                id,
                blobUrl,
                safeFilename,
                fileSize: actualSize,
                targetSavePath: savePath,
              });
            },
          );

        } catch (err: any) {
          console.error('[ADL] onComplete error:', err);
          await this.updateState(id, DOWNLOAD_STATE.ERROR as DownloadState, {
            error: `Save failed: ${err?.message || 'Unknown error'} — click Retry`,
            errorMessage: `Save failed: ${err?.message || 'Unknown error'} — click Retry`,
          });
          this.queue.markDone(id);
          broadcastMessage({ type: MSG.DOWNLOAD_ERROR, id, error: err?.message });
        }
      },
      async (id, errorMsg) => {
        const cur = this.downloadCache.get(id);
        const curStatus = (cur?.status || (cur as any)?.state);
        if (
          curStatus === DOWNLOAD_STATE.CANCELLED ||
          curStatus === DOWNLOAD_STATE.PAUSED ||
          curStatus === DOWNLOAD_STATE.COMPLETED
        ) {
          this.queue.markDone(id);
          return;
        }

        await this.updateState(id, DOWNLOAD_STATE.ERROR as DownloadState, {
          error: errorMsg,
          errorMessage: errorMsg,
        });
        this.queue.markDone(id);
        broadcastMessage({ type: MSG.DOWNLOAD_ERROR, id, error: errorMsg });
      },
      async (meta) => {
        const cur = this.downloadCache.get(downloadId);
        const curStatus = (cur?.status || (cur as any)?.state);
        if (
          curStatus === DOWNLOAD_STATE.CANCELLED ||
          curStatus === DOWNLOAD_STATE.PAUSED ||
          curStatus === DOWNLOAD_STATE.COMPLETED ||
          curStatus === DOWNLOAD_STATE.ERROR
        ) {
          return;
        }

        // Server response headers arrived — resolve dynamic filename, MIME type, and category!
        const detectedCat = detectCategory(meta.filename, meta.mimeType);
        const updates: Record<string, any> = {
          filename: meta.filename,
          category: detectedCat,
          mimeType: meta.mimeType,
        };
        if (meta.hashExpected && !dl.hashExpected) {
          updates.hashExpected = meta.hashExpected;
        }
        if (meta.totalSize > 0) {
          updates.total = meta.totalSize;
          updates.filesize = meta.totalSize;
        }
        if (meta.etag) {
          updates.etag = meta.etag;
          dl.etag = meta.etag;
        }
        if (meta.lastModified) {
          updates.lastModified = meta.lastModified;
          dl.lastModified = meta.lastModified;
        }
        if (typeof meta.acceptsRanges === 'boolean') {
          updates.resumable = meta.acceptsRanges;
          dl.resumable = meta.acceptsRanges;
        }
        await this.updateState(downloadId, DOWNLOAD_STATE.DOWNLOADING as DownloadState, updates);
        broadcastMessage({
          type: MSG.DOWNLOAD_PROGRESS,
          id: downloadId,
          ...updates,
        });
      },
      this.rateLimiter
    );
  }

  public async saveExistingDownloadToDisk(dl: DownloadItem): Promise<void> {
    const id = dl.id;
    try {
      await this.updateState(id, DOWNLOAD_STATE.MERGING as DownloadState);
      const safeFilename = sanitizeFilename(dl.filename);
      const resolvedCategory = dl.category || detectCategory(safeFilename, dl.mimeType || undefined);
      const categoryFolder = this.settings.organizeByCategoryFolders
        ? (CATEGORY_FOLDER_NAMES[resolvedCategory] || undefined)
        : undefined;
      const savePath = buildSavePath(this.settings.defaultSavePath, safeFilename, categoryFolder);
      const chunkCount = dl.totalChunks || (dl as any).chunkCount || 1;
      const actualSize = dl.filesize || dl.receivedBytes || 0;

      retainOffscreenAssembly();
      let response: any;
      try {
        await ensureOffscreenDocument();

        response = await chrome.runtime.sendMessage({
          type: MSG.OFFSCREEN_CREATE_BLOB_URL,
          downloadId: id,
          chunkCount,
          mimeType: dl.mimeType || 'application/octet-stream',
          verifyHash: false,
        });
      } finally {
        releaseOffscreenAssembly();
      }

      if (!response || !response.success || !response.blobUrl) {
        throw new Error(response?.error || 'Failed to assemble existing download chunks from storage');
      }

      const blobUrl = response.blobUrl;
      this.ownBlobUrls.add(blobUrl);
      this.pendingBlobSaves.set(blobUrl, {
        id,
        targetSavePath: savePath,
        safeFilename,
        fileSize: actualSize,
      });

      chrome.downloads.download(
        {
          url: blobUrl,
          filename: savePath,
          saveAs: false,
          conflictAction: 'uniquify',
        },
        (chromeDlId) => {
          if (chrome.runtime.lastError || !chromeDlId) {
            const err = chrome.runtime.lastError?.message || 'Chrome download API rejected request';
            this.pendingBlobSaves.delete(blobUrl);
            revokeBlobUrl(blobUrl);
            this.updateState(id, DOWNLOAD_STATE.ERROR as DownloadState, {
              error: `Save failed: ${err} — click Retry`,
              errorMessage: `Save failed: ${err} — click Retry`,
            });
            this.queue.markDone(id);
            broadcastMessage({ type: MSG.DOWNLOAD_ERROR, id, error: err });
            return;
          }

          this.pendingChromeDownloads.set(chromeDlId, {
            id,
            blobUrl,
            safeFilename,
            fileSize: actualSize,
            targetSavePath: savePath,
          });
        }
      );
    } catch (err: any) {
      await this.updateState(id, DOWNLOAD_STATE.ERROR as DownloadState, {
        error: `Save failed: ${err?.message || 'Unknown error'} — click Retry`,
        errorMessage: `Save failed: ${err?.message || 'Unknown error'} — click Retry`,
      });
      this.queue.markDone(id);
      broadcastMessage({ type: MSG.DOWNLOAD_ERROR, id, error: err?.message });
    }
  }

  public handleDeterminingFilename(
    item: chrome.downloads.DownloadItem,
    suggest: (suggestion?: { filename: string; conflictAction?: 'uniquify' | 'overwrite' | 'prompt' }) => void
  ): boolean {
    let targetPath = '';

    const pendingBlob = this.pendingBlobSaves.get(item.url);
    if (pendingBlob?.targetSavePath) {
      targetPath = pendingBlob.targetSavePath;
    } else {
      let pending = this.pendingChromeDownloads.get(item.id);
      if (!pending && item.url) {
        pending = Array.from(this.pendingChromeDownloads.values()).find(p => p.blobUrl === item.url);
      }
      if (pending?.targetSavePath) {
        targetPath = pending.targetSavePath;
      }
    }

    if (targetPath) {
      suggest({
        filename: targetPath,
        conflictAction: 'uniquify',
      });
      return true;
    }

    suggest();
    return false;
  }

  public async restoreInProgressDownloads(): Promise<void> {
    const all = await loadDownloads();
    for (const dl of Object.values(all)) {
      this.downloadCache.set(dl.id, dl);
      const st = dl.status || (dl as any).state;

      // Completed, cancelled, and already-paused downloads must remain in their saved states.
      if (
        st === DOWNLOAD_STATE.CANCELLED ||
        st === DOWNLOAD_STATE.PAUSED ||
        st === DOWNLOAD_STATE.COMPLETED ||
        st === DOWNLOAD_STATE.ERROR
      ) {
        continue;
      }

      if (st === 'downloading' || st === 'connecting') {
        // Interrupted by browser shutdown — safely restore as PAUSED so network requests do NOT auto-start on launch.
        // User can resume explicitly whenever they want.
        await this.updateState(dl.id, DOWNLOAD_STATE.PAUSED as DownloadState, {
          speed: 0,
          eta: null,
          error: null,
          errorMessage: null,
        });
      } else if (st === 'queued') {
        // Pre-existing queued items only start if autoStart setting is enabled
        if (this.settings.autoStart) {
          this.queue.enqueue(dl.id);
        }
      } else if (st === 'merging' || st === 'verifying') {
        await this.updateState(dl.id, DOWNLOAD_STATE.ERROR as DownloadState, {
          error: 'Interrupted during merge — click Retry to re-download.',
          errorMessage: 'Interrupted during merge — click Retry to re-download.',
        });
        broadcastMessage({
          type: MSG.DOWNLOAD_ERROR,
          id: dl.id,
          error: 'Interrupted during merge — click Retry to re-download.',
        });
      }
    }
  }

  public async handleChromeDownloadChange(delta: chrome.downloads.DownloadDelta): Promise<void> {
    const pending = this.pendingChromeDownloads.get(delta.id);
    if (!pending) return;

    if (delta.state) {
      if (delta.state.current === 'complete') {
        this.pendingChromeDownloads.delete(delta.id);
        this.pendingBlobSaves.delete(pending.blobUrl);
        revokeBlobUrl(pending.blobUrl);
        await clearChunks(pending.id);

        const completedAt = Date.now();
        const dlRecord: any = await getDownload(pending.id);
        let resolvedSize = pending.fileSize || dlRecord?.filesize || dlRecord?.total || dlRecord?.receivedBytes || dlRecord?.received || 0;
        let actualFinalPath = pending.targetSavePath || pending.safeFilename;
        let actualFilename = pending.safeFilename;

        if (typeof chrome !== 'undefined' && chrome.downloads?.search) {
          try {
            const results = await chrome.downloads.search({ id: delta.id });
            if (results && results[0]) {
              resolvedSize = results[0].fileSize || results[0].totalBytes || results[0].bytesReceived || resolvedSize;
              if (results[0].filename) {
                actualFinalPath = results[0].filename;
                actualFilename = getFilename(results[0].filename) || pending.safeFilename;
              }
            }
          } catch {
            // ignore
          }
        }

        const updatedDl = await this.updateState(pending.id, DOWNLOAD_STATE.COMPLETED as DownloadState, {
          completedAt,
          percent: 100,
          progress: 100,
          speed: 0,
          eta: 0,
          filename: actualFilename,
          savePath: actualFinalPath,
          total: resolvedSize,
          filesize: resolvedSize,
          received: resolvedSize,
          receivedBytes: resolvedSize,
        });

        await recordCompletion(resolvedSize, completedAt - (dlRecord?.startedAt || completedAt));
        this.queue.markDone(pending.id);
        broadcastMessage({
          type: MSG.DOWNLOAD_COMPLETED,
          id: pending.id,
          filename: actualFilename,
          total: resolvedSize,
          filesize: resolvedSize,
          received: resolvedSize,
          receivedBytes: resolvedSize,
          download: updatedDl,
        });

        if (this.settings.showNotifications) {
          showNotification('Download Complete', actualFilename);
        }

        await this.pruneHistory();

        await closeOffscreenDocumentIfIdle(this.pendingChromeDownloads.size > 0);
      } else if (delta.state.current === 'interrupted') {
        const isUserCancel = delta.error?.current === 'USER_CANCELED';
        this.pendingChromeDownloads.delete(delta.id);
        this.pendingBlobSaves.delete(pending.blobUrl);
        revokeBlobUrl(pending.blobUrl);

        if (isUserCancel && this.settings.preserveChunksOnCancel) {
          // Do NOT clear chunks! The entire download is safely stored in local IndexedDB.
          await this.updateState(pending.id, DOWNLOAD_STATE.PAUSED as DownloadState, {
            error: null,
            errorMessage: 'Save location was cancelled. Download is 100% complete in storage — click Resume / Retry to save to disk.',
            percent: 100,
            progress: 100,
            isReadyToSave: true,
          } as any);
          broadcastMessage({
            type: MSG.DOWNLOAD_PAUSED,
            id: pending.id,
            isReadyToSave: true,
          });
        } else {
          await clearChunks(pending.id);
          await this.updateState(pending.id, DOWNLOAD_STATE.ERROR as DownloadState, {
            error: `Chrome download interrupted (${delta.error?.current || 'unknown'}) — click Retry`,
            errorMessage: `Chrome download interrupted (${delta.error?.current || 'unknown'}) — click Retry`,
          });
          broadcastMessage({ type: MSG.DOWNLOAD_ERROR, id: pending.id, error: delta.error?.current });
        }

        this.queue.markDone(pending.id);
        await closeOffscreenDocumentIfIdle(this.pendingChromeDownloads.size > 0);
      }
    }
  }

  public async handleChromeDownloadCreated(item: chrome.downloads.DownloadItem): Promise<void> {
    if (!this.settings.interceptDownloads) return;

    if (!item.url) return;

    // Only intercept newly created, active in-progress downloads
    if (item.state && item.state !== 'in_progress') return;

    // Ignore historical or restored downloads on browser startup (older than 60s)
    if (item.startTime) {
      const ageMs = Date.now() - new Date(item.startTime).getTime();
      if (ageMs > 60_000) return;
    }

    if (this.ownBlobUrls.has(item.url)) {
      this.ownBlobUrls.delete(item.url);
      return;
    }

    if (item.url.startsWith('blob:') || item.url.startsWith('data:')) return;

    if (item.byExtensionId && item.byExtensionId === chrome.runtime.id) {
      return;
    }

    // Prevent duplicate re-interception of downloads already active, queued, or explicitly cancelled
    for (const dl of this.downloadCache.values()) {
      if (dl.url === item.url) {
        const st = dl.status || (dl as any).state;
        if (
          st === DOWNLOAD_STATE.CANCELLED ||
          st === DOWNLOAD_STATE.DOWNLOADING ||
          st === DOWNLOAD_STATE.CONNECTING ||
          st === DOWNLOAD_STATE.PAUSED ||
          st === DOWNLOAD_STATE.QUEUED
        ) {
          return;
        }
      }
    }

    // Dynamically bypass interception for user-initiated right-click Save As (images, links, media, page)
    if (this.rightClickDetector.isRightClickDownload(item)) {
      console.log(`[ADL] Bypassing interception for user-initiated Save As: ${item.url}`);
      return;
    }

    // Dynamically bypass interception if download corresponds to an active tab
    // (e.g. user opened an image/media/PDF directly in a tab and clicked "Save image as..." or Ctrl+S)
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        const activeTabs = await chrome.tabs.query({ active: true });
        const itemFn = item.filename ? getFilename(item.filename) : getFilename(item.url);

        for (const tab of activeTabs) {
          if (!tab.url) continue;

          // A. URL match with active tab
          if (urlsMatch(item.url, tab.url) || (item.finalUrl && urlsMatch(item.finalUrl, tab.url))) {
            console.log(`[ADL] Bypassing interception: download URL matches active tab URL (${tab.url})`);
            return;
          }

          // B. Filename match on same origin with active tab
          const tabFn = getFilename(tab.url);
          if (itemFn && tabFn && itemFn.toLowerCase() === tabFn.toLowerCase()) {
            try {
              const tabOrigin = new URL(tab.url).origin;
              const itemOrigin = new URL(item.url).origin;
              if (tabOrigin === itemOrigin) {
                console.log(`[ADL] Bypassing interception: download filename matches active tab media (${tabFn})`);
                return;
              }
            } catch {
              // ignore
            }
          }

          // C. Tab title match (Chrome sets standalone media tab title to "filename.ext (dimensions)")
          if (tab.title && itemFn && tab.title.toLowerCase().startsWith(itemFn.toLowerCase())) {
            console.log(`[ADL] Bypassing interception: download filename matches active tab title (${tab.title})`);
            return;
          }
        }
      }
    } catch (tabErr) {
      console.warn('[ADL] Error querying active tabs for Save As detection:', tabErr);
    }

    try {
      chrome.downloads.cancel(item.id, () => {
        if (chrome.runtime?.lastError) { /* ignore */ }
        try {
          chrome.downloads.erase({ id: item.id }, () => {
            if (chrome.runtime?.lastError) { /* ignore */ }
          });
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }

    await this.addDownload({
      url: item.url,
      filename: item.filename || getFilenameFromUrl(item.url),
      mimeType: item.mime || undefined,
      referrer: item.referrer || '',
    });
  }

  public async showInFolder(id: string): Promise<boolean> {
    const dl = await getDownload(id);
    if (!dl) return false;
    const filename = dl.filename || '';
    chrome.downloads.search(
      { filenameRegex: escapeRegex(filename) + '$', limit: 1, orderBy: ['-startTime'] },
      (results) => {
        if (results && results.length > 0 && results[0]) {
          chrome.downloads.show(results[0].id);
        } else {
          chrome.tabs.create({ url: 'chrome://downloads' });
        }
      },
    );
    return true;
  }

  public cleanupPending(downloadId: string): void {
    cleanupPendingChromeDownload(downloadId, this.pendingChromeDownloads);
    for (const [blobUrl, saveInfo] of this.pendingBlobSaves.entries()) {
      if (saveInfo.id === downloadId) {
        this.pendingBlobSaves.delete(blobUrl);
        revokeBlobUrl(blobUrl);
      }
    }
  }

  public clearFinishedDownloads(): void {
    for (const [id, dl] of this.downloadCache.entries()) {
      const st = dl.status || (dl as any).state;
      if (![
        DOWNLOAD_STATE.DOWNLOADING,
        DOWNLOAD_STATE.QUEUED,
        DOWNLOAD_STATE.CONNECTING,
        DOWNLOAD_STATE.PAUSED,
        DOWNLOAD_STATE.MERGING,
        DOWNLOAD_STATE.VERIFYING,
      ].includes(st as any)) {
        this.downloadCache.delete(id);
      }
    }
    updateBadge(this.downloadCache.values());
  }

  public async pruneHistory(): Promise<void> {
    const limit = Math.max(10, this.settings.maxHistoryItems || 500);
    const all = await loadDownloads();
    const finished: DownloadItem[] = [];
    const active: Record<string, DownloadItem> = {};

    for (const [id, dl] of Object.entries(all)) {
      const st = dl.status || (dl as any).state;
      if ([
        DOWNLOAD_STATE.DOWNLOADING,
        DOWNLOAD_STATE.QUEUED,
        DOWNLOAD_STATE.CONNECTING,
        DOWNLOAD_STATE.PAUSED,
        DOWNLOAD_STATE.MERGING,
        DOWNLOAD_STATE.VERIFYING
      ].includes(st as any)) {
        active[id] = dl;
      } else {
        finished.push(dl);
      }
    }

    if (finished.length > limit) {
      finished.sort((a, b) => (b.completedAt || b.createdAt || 0) - (a.completedAt || a.createdAt || 0));
      const kept = finished.slice(0, limit);
      const toDelete = finished.slice(limit);

      for (const dl of toDelete) {
        this.downloadCache.delete(dl.id);
      }
      updateBadge(this.downloadCache.values());

      const updatedMap = { ...active };
      for (const dl of kept) {
        updatedMap[dl.id] = dl;
      }
      await saveDownloads(updatedMap);
    }
  }
}
