// ============================================================
//  All-Downloader — Service Worker (TypeScript)
//  Entry point for ALL extension logic.
// ============================================================
import { MSG, DOWNLOAD_STATE, DEFAULT_SETTINGS } from '../shared/constants.js';
import {
  generateId, getFilenameFromUrl, detectCategory,
  calcPercent
} from '../shared/utils.js';
import {
  upsertDownload, getDownload, deleteDownload,
  loadDownloads, loadSettings, saveSettings,
  clearHistory, recordCompletion, clearChunks
} from './storage.js';
import { startDownload, pauseDownload, cancelDownload } from './download-engine.js';
import { playDownloadStartAnimation } from './icon-animator.js';
import { QueueManager } from './queue-manager.js';
import type { DownloadItem, ExtensionSettings, DownloadState } from '../shared/types.js';

// ─────────────────────────────────────────────────────────────
//  Globals
// ─────────────────────────────────────────────────────────────

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS } as ExtensionSettings;
const downloadCache = new Map<string, DownloadItem>();
const _ownBlobUrls = new Set<string>();

interface PendingChromeDownload {
  id: string;
  blobUrl: string;
  safeFilename: string;
  fileSize: number;
}

const pendingChromeDownloads = new Map<number, PendingChromeDownload>();
let creatingOffscreenPromise: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  const path = 'src/offscreen/offscreen.html';
  const offscreenUrl = chrome.runtime.getURL(path);

  if ('getContexts' in chrome.runtime) {
    const contexts = await (chrome.runtime as any).getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });
    if (contexts && contexts.length > 0) return;
  } else {
    const matchedClients = await (self as any).clients?.matchAll();
    if (matchedClients?.some((c: any) => c.url === offscreenUrl)) return;
  }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: path,
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: 'Create Blob URL for streaming multi-segment downloads to disk without memory freeze',
      });
    } catch (err: any) {
      if (!err.message?.includes('Only a single offscreen document may be created')) {
        throw err;
      }
    } finally {
      creatingOffscreenPromise = null;
    }
  })();

  await creatingOffscreenPromise;
}

async function closeOffscreenDocumentIfIdle(): Promise<void> {
  if (pendingChromeDownloads.size > 0) return;
  try {
    if ('getContexts' in chrome.runtime) {
      const contexts = await (chrome.runtime as any).getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
      });
      if (contexts && contexts.length > 0) {
        await chrome.offscreen.closeDocument();
      }
    }
  } catch {
    // Ignore if already closed
  }
}

function _cleanupPendingChromeDownload(downloadId: string): void {
  for (const [chromeDlId, pending] of pendingChromeDownloads.entries()) {
    if (pending.id === downloadId) {
      chrome.downloads.cancel(chromeDlId).catch(() => {});
      chrome.runtime.sendMessage({
        type: MSG.OFFSCREEN_REVOKE_BLOB_URL,
        blobUrl: pending.blobUrl,
      }).catch(() => {});
      pendingChromeDownloads.delete(chromeDlId);
      closeOffscreenDocumentIfIdle().catch(() => {});
      break;
    }
  }
}

chrome.downloads.onChanged.addListener(async (delta) => {
  const pending = pendingChromeDownloads.get(delta.id);
  if (!pending) return;

  if (delta.state) {
    if (delta.state.current === 'complete') {
      pendingChromeDownloads.delete(delta.id);

      // Revoke the blob URL in the offscreen document
      chrome.runtime.sendMessage({
        type: MSG.OFFSCREEN_REVOKE_BLOB_URL,
        blobUrl: pending.blobUrl,
      }).catch(() => {});

      // Clear disk-backed chunks from IndexedDB
      await clearChunks(pending.id);

      // Complete download state
      const completedAt = Date.now();
      const dlRecord: any = await getDownload(pending.id);
      await _updateState(pending.id, DOWNLOAD_STATE.COMPLETED as DownloadState, {
        completedAt,
        percent: 100,
        progress: 100,
        speed: 0,
        eta: 0,
        filename: pending.safeFilename,
      });

      await recordCompletion(pending.fileSize, completedAt - (dlRecord?.startedAt || completedAt));
      queue.markDone(pending.id);
      _broadcast({ type: MSG.DOWNLOAD_COMPLETED, id: pending.id });

      if (settings.showNotifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('src/assets/icons/icon48.png'),
          title: 'Download Complete',
          message: pending.safeFilename,
        });
      }

      await closeOffscreenDocumentIfIdle();
    } else if (delta.state.current === 'interrupted') {
      pendingChromeDownloads.delete(delta.id);

      chrome.runtime.sendMessage({
        type: MSG.OFFSCREEN_REVOKE_BLOB_URL,
        blobUrl: pending.blobUrl,
      }).catch(() => {});

      await clearChunks(pending.id);

      await _updateState(pending.id, DOWNLOAD_STATE.ERROR as DownloadState, {
        error: `Chrome download interrupted (${delta.error?.current || 'unknown'}) — click Retry`,
        errorMessage: `Chrome download interrupted (${delta.error?.current || 'unknown'}) — click Retry`,
      });
      queue.markDone(pending.id);
      _broadcast({ type: MSG.DOWNLOAD_ERROR, id: pending.id, error: delta.error?.current });

      await closeOffscreenDocumentIfIdle();
    }
  }
});

const queue = new QueueManager({
  maxConcurrent: settings.maxConcurrent,
  onDequeue: (downloadId: string) => {
    _executeDownload(downloadId);
  },
});

// ─────────────────────────────────────────────────────────────
//  Initialise on SW startup
// ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[ADL] Extension installed / updated.');
  settings = await loadSettings();
  queue.setMaxConcurrent(settings.maxConcurrent);
  await _restoreInProgressDownloads();
  _setupContextMenu();
});

self.addEventListener('activate', async () => {
  settings = await loadSettings();
  queue.setMaxConcurrent(settings.maxConcurrent);
  await _restoreInProgressDownloads();
  _updateBadge();
});

// ─────────────────────────────────────────────────────────────
//  Download Interception
// ─────────────────────────────────────────────────────────────

chrome.downloads.onCreated.addListener(async (item) => {
  if (!settings.interceptDownloads) return;

  if (!item.url) return;
  if (_ownBlobUrls.has(item.url)) {
    _ownBlobUrls.delete(item.url);
    return;
  }

  if (item.url.startsWith('blob:') || item.url.startsWith('data:')) return;

  if (item.filename && (item.filename.startsWith('/') || /^[A-Za-z]:[/\\]/.test(item.filename))) {
    return;
  }

  chrome.downloads.cancel(item.id, () => {
    chrome.downloads.erase({ id: item.id });
  });

  await _addDownload({
    url: item.url,
    filename: item.filename || getFilenameFromUrl(item.url),
    mimeType: item.mime || undefined,
    referrer: item.referrer || '',
  });
});

// ─────────────────────────────────────────────────────────────
//  Context Menu
// ─────────────────────────────────────────────────────────────

function _setupContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'adl-download-link',
      title: 'Download with All Downloader',
      contexts: ['link', 'image', 'video', 'audio'],
    });
    chrome.contextMenus.create({
      id: 'adl-open-dashboard',
      title: 'Open All Downloader Dashboard',
      contexts: ['action'],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'adl-download-link') {
    const url = info.linkUrl || info.srcUrl;
    if (url) await _addDownload({ url, filename: getFilenameFromUrl(url) });
  }
  if (info.menuItemId === 'adl-open-dashboard') {
    _openDashboard();
  }
});

// ─────────────────────────────────────────────────────────────
//  Keyboard shortcut
// ─────────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-dashboard') _openDashboard();
});

// ─────────────────────────────────────────────────────────────
//  Scheduled alarms
// ─────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  queue.handleAlarm(alarm.name);
});

// ─────────────────────────────────────────────────────────────
//  Message Handler (UI ↔ SW)
// ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  _handleMessage(msg).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err?.message || 'Error handling message' });
  });
  return true;
});

async function _handleMessage(msg: any): Promise<any> {
  switch (msg?.type) {

    case MSG.GET_DOWNLOADS: {
      const all = await loadDownloads();
      return { ok: true, downloads: Object.values(all), queueOrder: queue.getStatus().queue };
    }

    case MSG.PRIORITIZE_DOWNLOAD: {
      queue.prioritize(msg.id);
      return { ok: true, queueOrder: queue.getStatus().queue };
    }

    case MSG.MOVE_QUEUE_ITEM: {
      queue.move(msg.id, msg.direction);
      return { ok: true, queueOrder: queue.getStatus().queue };
    }

    case MSG.START_QUEUED_NOW: {
      const dl = await getDownload(msg.id);
      if (!dl) return { ok: false };
      queue.remove(msg.id);
      queue.markRunning(msg.id);
      await _executeDownload(msg.id);
      return { ok: true, queueOrder: queue.getStatus().queue };
    }

    case MSG.CLEAR_QUEUE: {
      const ids = queue.clear();
      for (const id of ids) {
        await cancelDownload(id);
        await _updateState(id, DOWNLOAD_STATE.CANCELLED as DownloadState);
        _broadcast({ type: MSG.DOWNLOAD_CANCELLED, id });
      }
      return { ok: true, queueOrder: [] };
    }

    case MSG.START_DOWNLOAD: {
      const dl = await _addDownload(msg.payload || {});
      return { ok: true, download: dl };
    }

    case MSG.PAUSE_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      const state = dl?.status || (dl as any)?.state;
      if (!dl || state !== DOWNLOAD_STATE.DOWNLOADING) return { ok: false };
      pauseDownload(msg.id);
      await _updateState(msg.id, DOWNLOAD_STATE.PAUSED as DownloadState);
      queue.markDone(msg.id);
      _broadcast({ type: MSG.DOWNLOAD_PAUSED, id: msg.id });
      return { ok: true };
    }

    case MSG.RESUME_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      const state = dl?.status || (dl as any)?.state;
      if (!dl || state !== DOWNLOAD_STATE.PAUSED) return { ok: false };
      await _updateState(msg.id, DOWNLOAD_STATE.QUEUED as DownloadState);
      queue.enqueue(msg.id);
      return { ok: true };
    }

    case MSG.CANCEL_DOWNLOAD: {
      await cancelDownload(msg.id);
      _cleanupPendingChromeDownload(msg.id);
      await _updateState(msg.id, DOWNLOAD_STATE.CANCELLED as DownloadState);
      queue.remove(msg.id);
      _broadcast({ type: MSG.DOWNLOAD_CANCELLED, id: msg.id });
      return { ok: true };
    }

    case MSG.RETRY_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      if (!dl) return { ok: false };
      await _updateState(msg.id, DOWNLOAD_STATE.QUEUED as DownloadState, {
        errorMessage: null,
        error: null,
        receivedBytes: 0,
        received: 0,
        progress: 0,
        percent: 0
      } as any);
      queue.enqueue(msg.id);
      return { ok: true };
    }

    case MSG.DELETE_DOWNLOAD: {
      await cancelDownload(msg.id);
      _cleanupPendingChromeDownload(msg.id);
      await deleteDownload(msg.id);
      queue.remove(msg.id);
      downloadCache.delete(msg.id);
      return { ok: true };
    }

    case MSG.GET_SETTINGS: {
      return { ok: true, settings };
    }

    case MSG.UPDATE_SETTINGS: {
      settings = await saveSettings(msg.payload);
      queue.setMaxConcurrent(settings.maxConcurrent);
      return { ok: true, settings };
    }

    case MSG.CLEAR_HISTORY: {
      await clearHistory();
      return { ok: true };
    }

    case MSG.OPEN_DASHBOARD: {
      _openDashboard();
      return { ok: true };
    }

    case MSG.SHOW_IN_FOLDER: {
      const dl = await getDownload(msg.id);
      if (!dl) return { ok: false };
      const filename = dl.filename || '';
      chrome.downloads.search(
        { filenameRegex: _escapeRegex(filename) + '$', limit: 1, orderBy: ['-startTime'] },
        (results) => {
          if (results && results.length > 0 && results[0]) {
            chrome.downloads.show(results[0].id);
          } else {
            chrome.tabs.create({ url: 'chrome://downloads' });
          }
        },
      );
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message type: ${msg?.type}` };
  }
}

// ─────────────────────────────────────────────────────────────
//  Download lifecycle
// ─────────────────────────────────────────────────────────────

interface AddDownloadOptions {
  url: string;
  filename?: string;
  referrer?: string;
  mimeType?: string;
  scheduledAt?: number | null;
}

async function _addDownload({ url, filename, referrer = '', mimeType, scheduledAt = null }: AddDownloadOptions): Promise<DownloadItem> {
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
  downloadCache.set(id, download);

  _broadcast({ type: MSG.DOWNLOAD_ADDED, download });
  _updateBadge();
  playDownloadStartAnimation(() => _updateBadge());

  if (settings.autoStart) {
    queue.enqueue(id, scheduledAt);
  }

  return download;
}

async function _executeDownload(downloadId: string): Promise<void> {
  const dl = await getDownload(downloadId);
  if (!dl) { queue.markDone(downloadId); return; }

  await _updateState(downloadId, DOWNLOAD_STATE.CONNECTING as DownloadState, { startedAt: Date.now() });

  await startDownload(
    dl,
    settings,
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
      await _updateState(id, DOWNLOAD_STATE.DOWNLOADING as DownloadState, update);
      _broadcast({ type: MSG.DOWNLOAD_PROGRESS, id, ...update });
    },
    async (id, result, finalFilename) => {
      try {
        await _updateState(id, DOWNLOAD_STATE.MERGING as DownloadState);

        const safeFilename = _sanitizeFilename(finalFilename);
        const savePath = _buildSavePath(settings.defaultSavePath, safeFilename);
        const resolvedMime = result.mimeType || dl.mimeType || null;
        const resolvedCategory = detectCategory(safeFilename, resolvedMime);

        // Update with final MIME type and category
        await _updateState(id, DOWNLOAD_STATE.MERGING as DownloadState, {
          category: resolvedCategory,
          mimeType: resolvedMime,
        });

        // 1. Ensure Offscreen Document is active
        await ensureOffscreenDocument();

        // 2. Request Offscreen Document to create Blob URL from IndexedDB chunks (zero-copy pointer composition)
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

        // 3. Initiate native Chrome streaming download to user disk with zero memory freeze
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
              chrome.runtime.sendMessage({
                type: MSG.OFFSCREEN_REVOKE_BLOB_URL,
                blobUrl,
              }).catch(() => {});
              _updateState(id, DOWNLOAD_STATE.ERROR as DownloadState, {
                error: `Save failed: ${err} — click Retry`,
                errorMessage: `Save failed: ${err} — click Retry`,
              });
              queue.markDone(id);
              _broadcast({ type: MSG.DOWNLOAD_ERROR, id, error: err });
              return;
            }

            // Map chrome download ID to handle completion via chrome.downloads.onChanged
            pendingChromeDownloads.set(chromeDlId, {
              id,
              blobUrl,
              safeFilename,
              fileSize: result.totalSize,
            });
          },
        );

      } catch (err: any) {
        console.error('[ADL] onComplete error:', err);
        await _updateState(id, DOWNLOAD_STATE.ERROR as DownloadState, {
          error: `Save failed: ${err?.message || 'Unknown error'} — click Retry`,
          errorMessage: `Save failed: ${err?.message || 'Unknown error'} — click Retry`,
        });
        queue.markDone(id);
        _broadcast({ type: MSG.DOWNLOAD_ERROR, id, error: err?.message });
      }
    },
    async (id, errorMsg) => {
      await _updateState(id, DOWNLOAD_STATE.ERROR as DownloadState, {
        error: errorMsg,
        errorMessage: errorMsg
      });
      queue.markDone(id);
      _broadcast({ type: MSG.DOWNLOAD_ERROR, id, error: errorMsg });
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
      await _updateState(downloadId, DOWNLOAD_STATE.DOWNLOADING as DownloadState, updates);
      _broadcast({
        type: MSG.DOWNLOAD_PROGRESS,
        id: downloadId,
        ...updates,
      });
    }
  );
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

async function _updateState(id: string, state: DownloadState, extra: Record<string, any> = {}): Promise<DownloadItem> {
  const dl = downloadCache.get(id) || await getDownload(id) || {} as any;
  const updated: DownloadItem = {
    ...dl,
    id,
    status: state,
    state,
    ...extra
  };
  downloadCache.set(id, updated);
  await upsertDownload(updated);
  _updateBadge();
  return updated;
}

function _broadcast(payload: Record<string, any>): void {
  chrome.runtime.sendMessage(payload).catch(() => {});
}

function _updateBadge(): void {
  const ACTIVE_STATES: DownloadState[] = [
    DOWNLOAD_STATE.QUEUED,
    DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.DOWNLOADING,
    DOWNLOAD_STATE.PAUSED,
    DOWNLOAD_STATE.MERGING,
    DOWNLOAD_STATE.VERIFYING,
  ] as DownloadState[];

  const activeCount = [...downloadCache.values()].filter(
    (dl: any) => ACTIVE_STATES.includes(dl.status || dl.state)
  ).length;

  if (activeCount > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#219ebc' });
    chrome.action.setBadgeText({ text: String(activeCount) });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function _restoreInProgressDownloads(): Promise<void> {
  const all = await loadDownloads();
  for (const dl of Object.values(all)) {
    downloadCache.set(dl.id, dl);
    const st = dl.status || (dl as any).state;

    if (st === 'downloading' || st === 'connecting' || st === 'queued') {
      await _updateState(dl.id, DOWNLOAD_STATE.QUEUED as DownloadState, { speed: 0, eta: null });
      queue.enqueue(dl.id);
    } else if (st === 'merging' || st === 'verifying') {
      await _updateState(dl.id, DOWNLOAD_STATE.ERROR as DownloadState, {
        error: 'Interrupted during merge — click Retry to re-download.',
        errorMessage: 'Interrupted during merge — click Retry to re-download.',
      });
      _broadcast({
        type: MSG.DOWNLOAD_ERROR,
        id: dl.id,
        error: 'Interrupted during merge — click Retry to re-download.'
      });
    }
  }
}

function _openDashboard(): void {
  const url = chrome.runtime.getURL('src/dashboard/dashboard.html');
  chrome.tabs.query({ url }, (tabs) => {
    if (tabs && tabs.length > 0 && tabs[0]?.id) {
      chrome.tabs.update(tabs[0].id, { active: true });
      if (tabs[0].windowId) {
        chrome.windows?.update(tabs[0].windowId, { focused: true });
      }
    } else {
      chrome.tabs.create({ url });
    }
  });
}


function _sanitizeFilename(name: string): string {
  if (!name || typeof name !== 'string') return 'download';

  let safe = name
    .replace(/\0/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  safe = safe.replace(/^\.+$/, '_');

  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(safe)) {
    safe = '_' + safe;
  }

  if (safe.length > 200) {
    const ext = safe.lastIndexOf('.');
    const extPart = ext > 0 ? safe.slice(ext) : '';
    const namePart = ext > 0 ? safe.slice(0, ext) : safe;
    safe = namePart.slice(0, 200 - extPart.length) + extPart;
  }

  return safe || 'download';
}

function _buildSavePath(subFolder: string, filename: string): string {
  if (!subFolder || typeof subFolder !== 'string' || !subFolder.trim()) {
    return filename;
  }

  const cleanFolder = subFolder
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .map(seg => _sanitizeFolderSegment(seg))
    .filter(Boolean)
    .join('/');

  return cleanFolder ? `${cleanFolder}/${filename}` : filename;
}

function _sanitizeFolderSegment(seg: string): string {
  if (!seg || typeof seg !== 'string') return '';

  let safe = seg
    .replace(/\0/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^\.+$/.test(safe)) return '';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(safe)) return '';
  if (safe.length > 100) safe = safe.slice(0, 100);

  return safe;
}

function _escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
