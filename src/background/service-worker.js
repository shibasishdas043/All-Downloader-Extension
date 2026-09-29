// ============================================================
//  All-Downloader — Service Worker (Main Background Script)
//  Entry point for ALL extension logic.
//  Handles: download interception, message routing, state mgmt.
// ============================================================
import { MSG, DOWNLOAD_STATE, DEFAULT_SETTINGS, UI } from '../shared/constants.js';
import {
  generateId, getFilenameFromUrl, detectCategory,
  calcPercent, parseContentDisposition
} from '../shared/utils.js';
import {
  upsertDownload, getDownload, deleteDownload,
  loadDownloads, loadSettings, saveSettings,
  clearHistory, recordCompletion, loadStats
} from './storage.js';
import { startDownload, pauseDownload, cancelDownload } from './download-engine.js';
import { QueueManager } from './queue-manager.js';
import { verifyIntegrity } from './integrity.js';

// ─────────────────────────────────────────────────────────────
//  Globals
// ─────────────────────────────────────────────────────────────

let settings = { ...DEFAULT_SETTINGS };
/** @type {Map<string, object>} In-memory download state cache */
const downloadCache = new Map();

const queue = new QueueManager({
  maxConcurrent: settings.maxConcurrent,
  onDequeue: (downloadId) => _executeDownload(downloadId),
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
});

// ─────────────────────────────────────────────────────────────
//  Download Interception
// ─────────────────────────────────────────────────────────────

chrome.downloads.onCreated.addListener(async (item) => {
  if (!settings.interceptDownloads) return;

  // Do NOT intercept internal extension blob downloads or data URLs
  if (!item.url || item.url.startsWith('blob:') || item.url.startsWith('data:')) {
    return;
  }

  // Cancel the native download so we take over
  chrome.downloads.cancel(item.id, () => {
    chrome.downloads.erase({ id: item.id });
  });

  await _addDownload({
    url:      item.url,
    filename: item.filename || getFilenameFromUrl(item.url),
    referrer: item.referrer || '',
  });
});

// ─────────────────────────────────────────────────────────────
//  Context Menu
// ─────────────────────────────────────────────────────────────

function _setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id:       'adl-download-link',
      title:    'Download with All-Downloader',
      contexts: ['link', 'image', 'video', 'audio'],
    });
    chrome.contextMenus.create({
      id:       'adl-open-dashboard',
      title:    'Open All-Downloader Dashboard',
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  _handleMessage(msg).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err.message });
  });
  return true; // keep port open for async response
});

async function _handleMessage(msg) {
  switch (msg.type) {

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
        await _updateState(id, DOWNLOAD_STATE.CANCELLED);
        _broadcast({ type: MSG.DOWNLOAD_CANCELLED, id });
      }
      return { ok: true, queueOrder: [] };
    }

    case MSG.START_DOWNLOAD: {
      const dl = await _addDownload(msg.payload);
      return { ok: true, download: dl };
    }

    case MSG.PAUSE_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      if (!dl || dl.state !== DOWNLOAD_STATE.DOWNLOADING) return { ok: false };
      pauseDownload(msg.id);
      await _updateState(msg.id, DOWNLOAD_STATE.PAUSED);
      queue.markDone(msg.id);
      _broadcast({ type: MSG.DOWNLOAD_PAUSED, id: msg.id });
      return { ok: true };
    }

    case MSG.RESUME_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      if (!dl || dl.state !== DOWNLOAD_STATE.PAUSED) return { ok: false };
      await _updateState(msg.id, DOWNLOAD_STATE.QUEUED);
      queue.enqueue(msg.id);
      return { ok: true };
    }

    case MSG.CANCEL_DOWNLOAD: {
      await cancelDownload(msg.id);
      await _updateState(msg.id, DOWNLOAD_STATE.CANCELLED);
      queue.remove(msg.id);
      _broadcast({ type: MSG.DOWNLOAD_CANCELLED, id: msg.id });
      return { ok: true };
    }

    case MSG.RETRY_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      if (!dl) return { ok: false };
      await _updateState(msg.id, DOWNLOAD_STATE.QUEUED, { error: null, received: 0, percent: 0 });
      queue.enqueue(msg.id);
      return { ok: true };
    }

    case MSG.DELETE_DOWNLOAD: {
      await cancelDownload(msg.id);
      await deleteDownload(msg.id);
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

    default:
      return { ok: false, error: `Unknown message type: ${msg.type}` };
  }
}

// ─────────────────────────────────────────────────────────────
//  Download lifecycle
// ─────────────────────────────────────────────────────────────

async function _addDownload({ url, filename, referrer = '', scheduledAt = null }) {
  const id = generateId();
  const name = filename || getFilenameFromUrl(url);
  const download = {
    id,
    url,
    filename:    name,
    category:    detectCategory(name),
    referrer,
    state:       DOWNLOAD_STATE.QUEUED,
    total:       0,
    received:    0,
    percent:     0,
    speed:       0,
    eta:         null,
    error:       null,
    createdAt:   Date.now(),
    startedAt:   null,
    completedAt: null,
    scheduledAt,
    chunked:     false,
    hash:        null,
  };

  await upsertDownload(download);
  downloadCache.set(id, download);

  _broadcast({ type: MSG.DOWNLOAD_ADDED, download });

  if (settings.autoStart) {
    queue.enqueue(id, scheduledAt);
  }

  return download;
}

async function _executeDownload(downloadId) {
  const dl = await getDownload(downloadId);
  if (!dl) { queue.markDone(downloadId); return; }

  await _updateState(downloadId, DOWNLOAD_STATE.CONNECTING, { startedAt: Date.now() });

  await startDownload(
    dl,
    settings,
    // onProgress
    async (id, received, total, speedSnap) => {
      const update = {
        state:    DOWNLOAD_STATE.DOWNLOADING,
        received,
        total,
        percent:  calcPercent(received, total),
        speed:    speedSnap.bytesPerSec,
        eta:      speedSnap.etaSec,
      };
      await _updateState(id, DOWNLOAD_STATE.DOWNLOADING, update);
      _broadcast({ type: MSG.DOWNLOAD_PROGRESS, id, ...update });
    },
    // onComplete
    async (id, blob, finalFilename) => {
      await _updateState(id, DOWNLOAD_STATE.MERGING);

      // ── Save the assembled file ───────────────────────────────
      // chrome.downloads.download filename is a path RELATIVE to the
      // browser's own default download directory (set by the user in
      // Chrome / Edge / Brave / Opera / Firefox settings).
      // We MUST NOT use an absolute path — browsers will reject it.
      // To use a sub-folder, we prepend a relative folder name only.
      const safeFilename = _sanitizeFilename(finalFilename);
      const savePath     = _buildSavePath(settings.defaultSavePath, safeFilename);

      const blobUrl = URL.createObjectURL(blob);
      chrome.downloads.download(
        {
          url:            blobUrl,
          filename:       savePath,        // relative path inside Downloads dir
          saveAs:         false,           // honour user's browser default — no dialog
          conflictAction: 'uniquify',      // auto-rename if file already exists
        },
        (_dlId) => {
          // Revoke after Chrome has consumed the blob URL.
          if (chrome.runtime.lastError) {
            console.error('[ADL] save error:', chrome.runtime.lastError.message);
          }
          URL.revokeObjectURL(blobUrl);
        },
      );

      const completedAt = Date.now();
      const dl = await getDownload(id);
      await _updateState(id, DOWNLOAD_STATE.COMPLETED, {
        completedAt,
        percent: 100,
        speed:   0,
        eta:     null,
      });

      await recordCompletion(blob.size, completedAt - (dl.startedAt || completedAt));
      queue.markDone(id);

      _broadcast({ type: MSG.DOWNLOAD_COMPLETED, id });

      if (settings.showNotifications) {
        chrome.notifications.create({
          type:    'basic',
          iconUrl: chrome.runtime.getURL('src/assets/icons/icon48.png'),
          title:   'Download Complete',
          message: finalFilename,
        });
      }
    },
    // onError
    async (id, errorMsg) => {
      await _updateState(id, DOWNLOAD_STATE.ERROR, { error: errorMsg });
      queue.markDone(id);
      _broadcast({ type: MSG.DOWNLOAD_ERROR, id, error: errorMsg });
    }
  );
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

async function _updateState(id, state, extra = {}) {
  const dl = downloadCache.get(id) || await getDownload(id) || {};
  const updated = { ...dl, id, state, ...extra };
  downloadCache.set(id, updated);
  await upsertDownload(updated);
  return updated;
}

function _broadcast(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {
    // UI may not be open — silently ignore
  });
}

async function _restoreInProgressDownloads() {
  const all = await loadDownloads();
  for (const dl of Object.values(all)) {
    downloadCache.set(dl.id, dl);
    // Re-queue anything that was active when SW was killed
    if ([DOWNLOAD_STATE.DOWNLOADING, DOWNLOAD_STATE.CONNECTING, DOWNLOAD_STATE.QUEUED].includes(dl.state)) {
      await _updateState(dl.id, DOWNLOAD_STATE.QUEUED, { speed: 0, eta: null });
      queue.enqueue(dl.id);
    }
  }
}

function _openDashboard() {
  const url = chrome.runtime.getURL('src/dashboard/dashboard.html');
  chrome.tabs.query({ url }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
    } else {
      chrome.tabs.create({ url });
    }
  });
}

// ─────────────────────────────────────────────────────────────
//  File-save helpers
// ─────────────────────────────────────────────────────────────

/**
 * Strip characters that are illegal in Windows / macOS / Linux filenames.
 * Also collapses multiple spaces/dots and trims leading/trailing dots & spaces.
 *
 * @param {string} name  Raw filename from server or URL
 * @returns {string}     Safe filename, falls back to 'download' if empty
 */
function _sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'download';

  let safe = name
    // Remove null bytes
    .replace(/\0/g, '')
    // Strip Windows-illegal characters: \ / : * ? " < > |
    .replace(/[\\/:*?"<>|]/g, '_')
    // Strip control characters (ASCII 0-31)
    .replace(/[\x00-\x1f]/g, '')
    // Collapse runs of whitespace into a single space
    .replace(/\s+/g, ' ')
    .trim();

  // Windows forbids filenames that are purely dots
  safe = safe.replace(/^\.+$/, '_');

  // Windows reserved names (case-insensitive): CON, PRN, AUX, NUL, COM1-9, LPT1-9
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(safe)) {
    safe = '_' + safe;
  }

  // Maximum filename length — 200 chars (leaves room for path prefix)
  if (safe.length > 200) {
    const ext   = safe.lastIndexOf('.');
    const extPart  = ext > 0 ? safe.slice(ext) : '';
    const namePart = ext > 0 ? safe.slice(0, ext) : safe;
    safe = namePart.slice(0, 200 - extPart.length) + extPart;
  }

  return safe || 'download';
}

/**
 * Build the relative save path understood by chrome.downloads.download().
 *
 * The filename parameter in chrome.downloads.download is ALWAYS relative
 * to the user's configured default Downloads directory in the browser.
 * There is no cross-browser API to read that absolute OS path —
 * it is intentionally sandboxed for security.
 *
 * Rules:
 *  - If defaultSavePath is empty / whitespace → save directly as `filename`
 *    in the Downloads root.
 *  - If defaultSavePath is set → save as `<sub-folder>/<filename>` inside
 *    the Downloads root.
 *  - Forward slashes only (Chrome normalises them on Windows automatically).
 *  - No leading slash allowed.
 *
 * @param {string} subFolder   settings.defaultSavePath (may be empty/whitespace)
 * @param {string} filename    Already-sanitized filename
 * @returns {string}           Relative path for chrome.downloads.download
 */
function _buildSavePath(subFolder, filename) {
  // Treat null / non-string / whitespace-only as "no sub-folder"
  if (!subFolder || typeof subFolder !== 'string' || !subFolder.trim()) {
    return filename;
  }

  // Sanitize the sub-folder: strip illegal chars, no absolute paths.
  // We use a dedicated folder sanitizer that returns '' for blank segments
  // (not 'download' like _sanitizeFilename does for file names).
  const cleanFolder = subFolder
    .replace(/\\/g, '/')           // normalise backslashes to forward slashes
    .replace(/^\/+/, '')           // strip any leading slash (no absolute path)
    .replace(/\/+$/, '')           // strip trailing slash
    .split('/')
    .map(seg => _sanitizeFolderSegment(seg))
    .filter(Boolean)               // drop empty/blank segments
    .join('/');

  return cleanFolder ? `${cleanFolder}/${filename}` : filename;
}

/**
 * Sanitize a single folder path segment.
 * Unlike _sanitizeFilename, returns '' for blank input (not 'download').
 * @param {string} seg
 * @returns {string}
 */
function _sanitizeFolderSegment(seg) {
  if (!seg || typeof seg !== 'string') return '';

  let safe = seg
    .replace(/\0/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Reject purely-dot segments (e.g. ".." path traversal attempt)
  if (/^\.+$/.test(safe)) return '';

  // Reject Windows reserved device names
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(safe)) return '';

  // Truncate very long folder names
  if (safe.length > 100) safe = safe.slice(0, 100);

  return safe;
}
