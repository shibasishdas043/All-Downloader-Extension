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
} from './services/index.js';
import { restoreDefaultIcon } from './icon-animator.js';

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS } as ExtensionSettings;
const coordinator = new DownloadCoordinator(settings);

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
  settings = await loadSettings();
  coordinator.updateSettings(settings);
  await coordinator.restoreInProgressDownloads();
  setupContextMenu();
  await injectContentScriptIntoExistingTabs();
});

self.addEventListener('activate', async () => {
  restoreDefaultIcon();
  settings = await loadSettings();
  coordinator.updateSettings(settings);
  await coordinator.restoreInProgressDownloads();
  updateBadge(coordinator.downloadCache.values());
  await injectContentScriptIntoExistingTabs();
});

// ─────────────────────────────────────────────────────────────
//  Chrome Download Events
// ─────────────────────────────────────────────────────────────

chrome.downloads.onCreated.addListener((item) => {
  coordinator.handleChromeDownloadCreated(item);
});

chrome.downloads.onChanged.addListener((delta) => {
  coordinator.handleChromeDownloadChange(delta);
});

// ─────────────────────────────────────────────────────────────
//  Context Menu & Commands & Alarms
// ─────────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info) => {
  handleContextMenuClick(info, (opts) => coordinator.addDownload(opts), coordinator);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-dashboard') openDashboard();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  coordinator.queue.handleAlarm(alarm.name);
});

// ─────────────────────────────────────────────────────────────
//  Message Handling (UI ↔ SW)
// ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg, coordinator, (updatedSettings) => {
    settings = updatedSettings;
  })
    .then(sendResponse)
    .catch((err) => {
      sendResponse({ ok: false, error: err?.message || 'Error handling message' });
    });
  return true;
});
