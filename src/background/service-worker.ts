// ============================================================
//  All-Downloader — Service Worker (TypeScript)
//  Entry point for extension background lifecycle & events.
// ============================================================
import { DEFAULT_SETTINGS } from '../shared/constants.js';
import { loadSettings } from './storage.js';
import type { ExtensionSettings } from '../shared/types.js';
import {
  DownloadCoordinator,
  handleMessage,
  setupContextMenu,
  handleContextMenuClick,
  openDashboard,
  updateBadge,
  keepAliveGuard,
} from './services/index.js';
import { restoreDefaultIcon } from './icon-animator.js';

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS } as ExtensionSettings;
const coordinator = new DownloadCoordinator(settings);

let initPromise: Promise<void> | null = null;

export async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const loaded = await loadSettings();
        settings = loaded;
        coordinator.updateSettings(loaded);
        await coordinator.restoreInProgressDownloads();
      } catch (err) {
        console.error('[ADL] Failed to initialize settings & downloads on wakeup:', err);
      }
    })();
  }
  return initPromise;
}

// Trigger initialization immediately on service worker boot
ensureInitialized();

// ─────────────────────────────────────────────────────────────
//  Lifecycle: onInstalled & activate
// ─────────────────────────────────────────────────────────────

async function injectContentScriptIntoExistingTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['src/content/link-interceptor.js'],
      }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[ADL] Extension installed / updated.');
  restoreDefaultIcon();
  await ensureInitialized();
  setupContextMenu();
  await injectContentScriptIntoExistingTabs();
});

self.addEventListener('activate', async () => {
  restoreDefaultIcon();
  await ensureInitialized();
  updateBadge(coordinator.downloadCache.values());
  await injectContentScriptIntoExistingTabs();
});

// ─────────────────────────────────────────────────────────────
//  Chrome Download Events
// ─────────────────────────────────────────────────────────────

chrome.downloads.onCreated.addListener(async (item) => {
  await ensureInitialized();
  coordinator.handleChromeDownloadCreated(item);
});

chrome.downloads.onChanged.addListener(async (delta) => {
  await ensureInitialized();
  coordinator.handleChromeDownloadChange(delta);
});

if (chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    coordinator.handleDeterminingFilename(item, suggest);
    // Crucial: handleDeterminingFilename calls suggest() synchronously.
    // Returning true tells Chrome to wait for an asynchronous suggest callback, which stalls
    // filename confirmation and causes files to be trapped as "Unconfirmed <id>.crdownload".
    return false;
  });
}

// ─────────────────────────────────────────────────────────────
//  Context Menu & Commands & Alarms
// ─────────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info) => {
  await ensureInitialized();
  handleContextMenuClick(info, (opts) => coordinator.addDownload(opts), coordinator);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-dashboard') openDashboard();
});

if (chrome.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener(() => {
    openDashboard();
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (keepAliveGuard.handleAlarm(alarm.name)) return;
  await ensureInitialized();
  coordinator.queue.handleAlarm(alarm.name);
});

// ─────────────────────────────────────────────────────────────
//  Message Handling (UI ↔ SW)
// ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ensureInitialized()
    .then(() => handleMessage(msg, coordinator, (updatedSettings) => {
      settings = updatedSettings;
    }))
    .then(sendResponse)
    .catch((err) => {
      sendResponse({ ok: false, error: err?.message || 'Error handling message' });
    });
  return true;
});
