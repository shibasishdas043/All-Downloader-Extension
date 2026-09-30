// ============================================================
//  All-Downloader — Download Coordinator Service
// ============================================================
import { MSG, DOWNLOAD_STATE } from '../../shared/constants.js';
import {
  generateId, getFilenameFromUrl, detectCategory,
  calcPercent
} from '../../shared/utils.js';
import {
  upsertDownload, getDownload, deleteDownload,
  loadDownloads, recordCompletion, clearChunks
} from '../storage.js';
import { startDownload, pauseDownload, cancelDownload } from '../download-engine.js';
import { playDownloadStartAnimation } from '../icon-animator.js';
import { QueueManager } from '../queue-manager.js';
import type { DownloadItem, ExtensionSettings, DownloadState } from '../../shared/types.js';
import { sanitizeFilename, buildSavePath, escapeRegex } from './path-sanitizer.js';
import { updateBadge, broadcastMessage, showNotification } from './badge-manager.js';
import {
  ensureOffscreenDocument, closeOffscreenDocumentIfIdle,
  cleanupPendingChromeDownload, revokeBlobUrl,
  type PendingChromeDownload
} from './offscreen-manager.js';

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
  public queue: QueueManager;

  constructor(settings: ExtensionSettings) {
    this.settings = settings;
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
      eta: 0,
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
    playDownloadStartAnimation(() => updateBadge(this.downloadCache.values()));

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
          eta: speedSnap.etaSec || 0,
        };
        await this.updateState(id, DOWNLOAD_STATE.DOWNLOADING as DownloadState, update);
        broadcastMessage({ type: MSG.DOWNLOAD_PROGRESS, id, ...update });
      },
      async (id, result, finalFilename) => {
        try {
          await this.updateState(id, DOWNLOAD_STATE.MERGING as DownloadState);

          const safeFilename = sanitizeFilename(finalFilename);
          const savePath = buildSavePath(this.settings.defaultSavePath, safeFilename);
          const resolvedMime = result.mimeType || dl.mimeType || null;
          const resolvedCategory = detectCategory(safeFilename, resolvedMime);

          // Update with final MIME type and category
          await this.updateState(id, DOWNLOAD_STATE.MERGING as DownloadState, {
            category: resolvedCategory,
            mimeType: resolvedMime,
          });

          // 1. Ensure Offscreen Document is active
          await ensureOffscreenDocument();

          // 2. Request Offscreen Document to create Blob URL from IndexedDB chunks
          const response = await chrome.runtime.sendMessage({
            type: MSG.OFFSCREEN_CREATE_BLOB_URL,
            downloadId: id,
            chunkCount: result.chunkCount,
            mimeType: result.mimeType,
          });

          if (!response || !response.success || !response.blobUrl) {
            throw new Error(response?.error || 'Failed to assemble download chunks in offscreen document');
          }

          const blobUrl = response.blobUrl;
          this.ownBlobUrls.add(blobUrl);

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
                fileSize: result.totalSize,
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
      }
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
        await this.updateState(pending.id, DOWNLOAD_STATE.COMPLETED as DownloadState, {
          completedAt,
          percent: 100,
          progress: 100,
          speed: 0,
          eta: 0,
          filename: pending.safeFilename,
        });

        await recordCompletion(pending.fileSize, completedAt - (dlRecord?.startedAt || completedAt));
        this.queue.markDone(pending.id);
        broadcastMessage({ type: MSG.DOWNLOAD_COMPLETED, id: pending.id });

        if (this.settings.showNotifications) {
          showNotification('Download Complete', pending.safeFilename);
        }

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
}
