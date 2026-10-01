// ============================================================
//  All-Downloader — Download Coordinator Service
// ============================================================
import { MSG, DOWNLOAD_STATE } from '../../shared/constants.js';
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
  type PendingChromeDownload
} from './offscreen-manager.js';
import { showDownloadStartedToast } from './toast-manager.js';
import { RightClickDetector, urlsMatch } from './right-click-detector.js';

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

    await this.updateState(downloadId, DOWNLOAD_STATE.CONNECTING as DownloadState, { startedAt: Date.now() });

    await startDownload(
      dl,
      this.settings,
      async (id, received, total, speedSnap) => {
        const percent = calcPercent(received, total);
        const update = {
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
        await this.updateState(id, DOWNLOAD_STATE.DOWNLOADING as DownloadState, update);
        broadcastMessage({ type: MSG.DOWNLOAD_PROGRESS, id, ...update });
      },
      async (id, result, finalFilename) => {
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
          const savePath = buildSavePath(this.settings.defaultSavePath, safeFilename);
          const resolvedMime = result.mimeType || dl.mimeType || null;
          const resolvedCategory = detectCategory(safeFilename, resolvedMime);

          // 1. Ensure Offscreen Document is active
          await ensureOffscreenDocument();

          // 2. Request Offscreen Document to create Blob URL from IndexedDB chunks (and compute hash if requested)
          const response = await chrome.runtime.sendMessage({
            type: MSG.OFFSCREEN_CREATE_BLOB_URL,
            downloadId: id,
            chunkCount: result.chunkCount,
            mimeType: result.mimeType,
            verifyHash: shouldVerify,
          });

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

          // Update with final MIME type, category, integrity verification, and verified file size
          await this.updateState(id, DOWNLOAD_STATE.MERGING as DownloadState, {
            category: resolvedCategory,
            mimeType: resolvedMime,
            hashActual: actualHash,
            hashVerified: verified,
            total: actualSize,
            filesize: actualSize,
            received: actualSize,
            receivedBytes: actualSize,
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
        await this.updateState(id, DOWNLOAD_STATE.ERROR as DownloadState, {
          error: errorMsg,
          errorMessage: errorMsg,
        });
        this.queue.markDone(id);
        broadcastMessage({ type: MSG.DOWNLOAD_ERROR, id, error: errorMsg });
      },
      async (meta) => {
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

  public async restoreInProgressDownloads(): Promise<void> {
    const all = await loadDownloads();
    for (const dl of Object.values(all)) {
      this.downloadCache.set(dl.id, dl);
      const st = dl.status || (dl as any).state;

      if (st === 'downloading' || st === 'connecting' || st === 'queued') {
        await this.updateState(dl.id, DOWNLOAD_STATE.QUEUED as DownloadState, { speed: 0, eta: null });
        this.queue.enqueue(dl.id);
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
        revokeBlobUrl(pending.blobUrl);
        await clearChunks(pending.id);

        const completedAt = Date.now();
        const dlRecord: any = await getDownload(pending.id);
        let resolvedSize = pending.fileSize || dlRecord?.filesize || dlRecord?.total || dlRecord?.receivedBytes || dlRecord?.received || 0;

        if (resolvedSize <= 0 && typeof chrome !== 'undefined' && chrome.downloads?.search) {
          try {
            const results = await chrome.downloads.search({ id: delta.id });
            if (results && results[0]) {
              resolvedSize = results[0].fileSize || results[0].totalBytes || results[0].bytesReceived || 0;
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
          filename: pending.safeFilename,
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
          filename: pending.safeFilename,
          total: resolvedSize,
          filesize: resolvedSize,
          received: resolvedSize,
          receivedBytes: resolvedSize,
          download: updatedDl,
        });

        if (this.settings.showNotifications) {
          showNotification('Download Complete', pending.safeFilename);
        }

        await this.pruneHistory();

        await closeOffscreenDocumentIfIdle(this.pendingChromeDownloads.size > 0);
      } else if (delta.state.current === 'interrupted') {
        this.pendingChromeDownloads.delete(delta.id);
        revokeBlobUrl(pending.blobUrl);
        await clearChunks(pending.id);

        await this.updateState(pending.id, DOWNLOAD_STATE.ERROR as DownloadState, {
          error: `Chrome download interrupted (${delta.error?.current || 'unknown'}) — click Retry`,
          errorMessage: `Chrome download interrupted (${delta.error?.current || 'unknown'}) — click Retry`,
        });
        this.queue.markDone(pending.id);
        broadcastMessage({ type: MSG.DOWNLOAD_ERROR, id: pending.id, error: delta.error?.current });

        await closeOffscreenDocumentIfIdle(this.pendingChromeDownloads.size > 0);
      }
    }
  }

  public async handleChromeDownloadCreated(item: chrome.downloads.DownloadItem): Promise<void> {
    if (!this.settings.interceptDownloads) return;

    if (!item.url) return;
    if (this.ownBlobUrls.has(item.url)) {
      this.ownBlobUrls.delete(item.url);
      return;
    }

    if (item.url.startsWith('blob:') || item.url.startsWith('data:')) return;

    if (item.byExtensionId && item.byExtensionId === chrome.runtime.id) {
      return;
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

    if (item.filename && (item.filename.startsWith('/') || /^[A-Za-z]:[/\\]/.test(item.filename))) {
      return;
    }

    chrome.downloads.cancel(item.id, () => {
      chrome.downloads.erase({ id: item.id });
    });

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

      const updatedMap = { ...active };
      for (const dl of kept) {
        updatedMap[dl.id] = dl;
      }
      await saveDownloads(updatedMap);
    }
  }
}
