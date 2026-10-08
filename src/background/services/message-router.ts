// ============================================================
//  All-Downloader — Service Worker Message Router
// ============================================================
import { MSG, DOWNLOAD_STATE } from '../../shared/constants.js';
import {
  loadDownloads, getDownload, deleteDownload,
  loadSettings, saveSettings, clearHistory
} from '../storage.js';
import { pauseDownload, cancelDownload } from '../download-engine.js';
import type { DownloadState, ExtensionSettings } from '../../shared/types.js';
import type { DownloadCoordinator } from './download-coordinator.js';
import { openDashboard, broadcastMessage, updateBadge } from './badge-manager.js';
import { scrapePageMediaAndLinks, parseHtmlMediaAndLinks } from './page-sniffer.js';

export async function handleMessage(
  msg: any,
  coordinator: DownloadCoordinator,
  onSettingsSaved: (settings: ExtensionSettings) => void
): Promise<any> {
  switch (msg?.type) {

    case MSG.GET_DOWNLOADS: {
      const all = await loadDownloads();
      return { ok: true, downloads: Object.values(all), queueOrder: coordinator.queue.getStatus().queue };
    }

    case MSG.PRIORITIZE_DOWNLOAD: {
      coordinator.queue.prioritize(msg.id);
      return { ok: true, queueOrder: coordinator.queue.getStatus().queue };
    }

    case MSG.MOVE_QUEUE_ITEM: {
      coordinator.queue.move(msg.id, msg.direction);
      return { ok: true, queueOrder: coordinator.queue.getStatus().queue };
    }

    case MSG.START_QUEUED_NOW: {
      const dl = await getDownload(msg.id);
      if (!dl) return { ok: false };
      coordinator.queue.remove(msg.id);
      coordinator.queue.markRunning(msg.id);
      broadcastMessage({ type: MSG.DOWNLOAD_RESUMED, id: msg.id });
      await coordinator.executeDownload(msg.id);
      return { ok: true, queueOrder: coordinator.queue.getStatus().queue };
    }

    case MSG.CLEAR_QUEUE: {
      const ids = coordinator.queue.clear();
      for (const id of ids) {
        coordinator.queue.remove(id);
        await coordinator.updateState(id, DOWNLOAD_STATE.CANCELLED as DownloadState, {
          speed: 0,
          eta: null,
        });
        broadcastMessage({ type: MSG.DOWNLOAD_CANCELLED, id });
        try {
          await cancelDownload(id);
        } catch (err) {
          console.warn('[ADL] Error during chunk cleanup for clear-queue item:', err);
        } finally {
          coordinator.cleanupPending(id);
        }
      }
      return { ok: true, queueOrder: [] };
    }

    case MSG.START_DOWNLOAD: {
      const dl = await coordinator.addDownload(msg.payload || {});
      return { ok: true, download: dl };
    }

    case MSG.PAUSE_DOWNLOAD: {
      if (coordinator.isStreamDownload(msg.id)) {
        await coordinator.pauseStreamDownload(msg.id);
        return { ok: true };
      }
      const dl = await getDownload(msg.id);
      const state = dl?.status || (dl as any)?.state;
      if (!dl || (state !== DOWNLOAD_STATE.DOWNLOADING && state !== DOWNLOAD_STATE.CONNECTING)) return { ok: false };
      coordinator.autoRetryBudget.delete(msg.id);
      pauseDownload(msg.id);
      await coordinator.updateState(msg.id, DOWNLOAD_STATE.PAUSED as DownloadState, {
        autoReconnecting: false,
      } as any);
      coordinator.queue.markDone(msg.id);
      broadcastMessage({ type: MSG.DOWNLOAD_PAUSED, id: msg.id });
      return { ok: true };
    }

    case MSG.RESUME_DOWNLOAD: {
      if (coordinator.isStreamDownload(msg.id)) {
        await coordinator.resumeStreamDownload(msg.id);
        return { ok: true };
      }
      const dl = await getDownload(msg.id);
      const state = dl?.status || (dl as any)?.state;
      if (!dl || (state !== DOWNLOAD_STATE.PAUSED && state !== DOWNLOAD_STATE.QUEUED)) return { ok: false };
      const nextState = coordinator.queue.hasFreeSlot() ? DOWNLOAD_STATE.CONNECTING : DOWNLOAD_STATE.QUEUED;
      const updated = await coordinator.updateState(msg.id, nextState as DownloadState);
      coordinator.queue.enqueue(msg.id);
      broadcastMessage({ type: MSG.DOWNLOAD_RESUMED, id: msg.id, download: updated });
      return { ok: true };
    }

    case MSG.CANCEL_DOWNLOAD: {
      if (coordinator.isStreamDownload(msg.id)) {
        await coordinator.cancelStreamDownload(msg.id);
        return { ok: true };
      }
      coordinator.autoRetryBudget.delete(msg.id);
      coordinator.queue.remove(msg.id);
      await coordinator.updateState(msg.id, DOWNLOAD_STATE.CANCELLED as DownloadState, {
        speed: 0,
        eta: null,
        autoReconnecting: false,
      } as any);
      broadcastMessage({ type: MSG.DOWNLOAD_CANCELLED, id: msg.id });
      try {
        await cancelDownload(msg.id);
      } catch (err) {
        console.warn('[ADL] Error during chunk cleanup for cancelled download:', err);
      } finally {
        coordinator.cleanupPending(msg.id);
      }
      return { ok: true };
    }

    case MSG.DIRECT_SAVE_COMPLETED: {
      const updated = await coordinator.handleDirectSaveCompleted(msg.id, msg.size, msg.filename);
      return { ok: Boolean(updated) };
    }

    case MSG.RETRY_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      if (!dl) return { ok: false };
      const nextState = coordinator.queue.hasFreeSlot() ? DOWNLOAD_STATE.CONNECTING : DOWNLOAD_STATE.QUEUED;

      if ((dl as any).isReadyToSave || (dl.receivedBytes && dl.filesize && dl.receivedBytes >= dl.filesize)) {
        // Chunks are already 100% saved in storage! Do not wipe received bytes to 0!
        const updated = await coordinator.updateState(msg.id, nextState as DownloadState, {
          errorMessage: null,
          error: null,
          speed: 0,
          eta: null,
        } as any);
        coordinator.queue.enqueue(msg.id);
        broadcastMessage({ type: MSG.DOWNLOAD_RESUMED, id: msg.id, download: updated });
        return { ok: true };
      }

      const updated = await coordinator.updateState(msg.id, nextState as DownloadState, {
        errorMessage: null,
        error: null,
        receivedBytes: 0,
        received: 0,
        progress: 0,
        percent: 0,
        speed: 0,
        eta: null,
      } as any);
      coordinator.queue.enqueue(msg.id);
      broadcastMessage({ type: MSG.DOWNLOAD_RESUMED, id: msg.id, download: updated });
      return { ok: true };
    }

    case MSG.DELETE_DOWNLOAD: {
      coordinator.queue.remove(msg.id);
      coordinator.downloadCache.delete(msg.id);
      await deleteDownload(msg.id);
      updateBadge(coordinator.downloadCache.values());
      broadcastMessage({ type: MSG.DOWNLOAD_DELETED, id: msg.id });
      try {
        await cancelDownload(msg.id);
      } catch (err) {
        console.warn('[ADL] Error during chunk cleanup for deleted download:', err);
      } finally {
        coordinator.cleanupPending(msg.id);
      }
      return { ok: true };
    }

    case MSG.GET_SETTINGS: {
      const freshSettings = await loadSettings();
      coordinator.updateSettings(freshSettings);
      return { ok: true, settings: freshSettings };
    }

    case MSG.UPDATE_SETTINGS: {
      const updated = await saveSettings(msg.payload || {});
      coordinator.updateSettings(updated);
      onSettingsSaved(updated);
      broadcastMessage({ type: MSG.SETTINGS_UPDATED, settings: updated });
      return { ok: true, settings: updated };
    }

    case MSG.CLEAR_HISTORY: {
      await clearHistory();
      coordinator.clearFinishedDownloads();
      updateBadge(coordinator.downloadCache.values());
      broadcastMessage({ type: MSG.CLEAR_HISTORY });
      return { ok: true };
    }

    case MSG.OPEN_DASHBOARD: {
      openDashboard(msg.view);
      return { ok: true };
    }

    case MSG.SHOW_IN_FOLDER: {
      const ok = await coordinator.showInFolder(msg.id);
      return { ok };
    }

    case MSG.USER_RIGHT_CLICKED: {
      coordinator.rightClickDetector.record(
        msg.payload?.urls || [],
        msg.payload?.pageUrl || ''
      );
      return { ok: true };
    }

    case MSG.USER_DISMISSED_CONTEXT_MENU: {
      coordinator.rightClickDetector.dismiss(msg.payload?.pageUrl || '');
      return { ok: true };
    }

    case MSG.SNIFF_PAGE: {
      const allTabs = await chrome.tabs.query({});
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = activeTabs[0];

      // Filter valid web tabs (exclude internal chrome pages and extension dashboard)
      const validWebTabs = allTabs.filter(t =>
        t.id &&
        t.url &&
        !t.url.startsWith('chrome-extension://') &&
        !t.url.startsWith('chrome://') &&
        !t.url.startsWith('edge://') &&
        !t.url.startsWith('about:') &&
        !t.url.startsWith('devtools://')
      );

      const availableTabs = validWebTabs.map(t => ({
        id: t.id!,
        title: t.title || '',
        url: t.url || ''
      }));

      let targetUrl = (msg.payload?.url || '').trim();
      let targetTab: chrome.tabs.Tab | undefined;

      if (targetUrl) {
        if (!/^https?:\/\//i.test(targetUrl)) {
          targetUrl = 'https://' + targetUrl;
        }
        // Check if an open tab matches targetUrl
        targetTab = validWebTabs.find(t => 
          t.url && (
            t.url.toLowerCase() === targetUrl.toLowerCase() ||
            t.url.toLowerCase().startsWith(targetUrl.toLowerCase()) ||
            targetUrl.toLowerCase().startsWith(t.url.toLowerCase())
          )
        );
      } else {
        // If current active tab is a valid web page (e.g. scanning from popup on a website):
        if (currentTab && currentTab.url && !currentTab.url.startsWith('chrome-extension://') && !currentTab.url.startsWith('chrome://') && !currentTab.url.startsWith('edge://') && !currentTab.url.startsWith('about:')) {
          targetTab = currentTab;
          targetUrl = currentTab.url;
        } else if (validWebTabs.length > 0) {
          // Dashboard scenario! Active tab is dashboard.html, so pick the most recent open web tab!
          targetTab = validWebTabs[0];
          targetUrl = validWebTabs[0].url || '';
        }
      }

      // 1. If target is an open browser tab, use executeScript for full live DOM + JS scraping
      if (targetTab && targetTab.id) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: targetTab.id },
            func: scrapePageMediaAndLinks,
          });
          const items = results?.[0]?.result || [];
          return {
            ok: true,
            items,
            pageTitle: targetTab.title || targetUrl,
            pageUrl: targetTab.url || targetUrl,
            availableTabs
          };
        } catch {
          // If executeScript fails (e.g. restricted permissions), fall back to fetch
        }
      }

      // 2. If target is a custom URL or tab execution failed, fetch HTML and parse resources
      if (targetUrl && /^https?:\/\//i.test(targetUrl)) {
        try {
          const res = await fetch(targetUrl, {
            headers: {
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
          });
          if (!res.ok) {
            return {
              ok: false,
              error: `HTTP ${res.status}: Failed to load ${targetUrl}`,
              items: [],
              pageUrl: targetUrl,
              availableTabs
            };
          }
          const html = await res.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const pageTitle = titleMatch ? titleMatch[1].trim() : targetUrl;
          const items = parseHtmlMediaAndLinks(html, targetUrl);
          return {
            ok: true,
            items,
            pageTitle,
            pageUrl: targetUrl,
            availableTabs
          };
        } catch (err: any) {
          return {
            ok: false,
            error: err?.message || `Failed to fetch page at ${targetUrl}`,
            items: [],
            pageUrl: targetUrl,
            availableTabs
          };
        }
      }

      // 3. No target URL provided and no active web tabs found
      return {
        ok: false,
        error: 'No active webpage found. Please enter a page URL above to scan.',
        items: [],
        pageUrl: '',
        availableTabs
      };
    }

    default:
      return { ok: false, error: `Unknown message type: ${msg?.type}` };
  }
}
