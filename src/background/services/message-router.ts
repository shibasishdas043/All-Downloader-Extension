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
import { scrapePageMediaAndLinks } from './page-sniffer.js';

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
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
        return { ok: false, error: 'Cannot sniff resources on browser internal pages', items: [] };
      }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrapePageMediaAndLinks,
        });
        const items = results?.[0]?.result || [];
        return { ok: true, items, pageTitle: tab.title || '', pageUrl: tab.url };
      } catch (err: any) {
        return { ok: false, error: err?.message || 'Failed to scan page resources', items: [] };
      }
    }

    default:
      return { ok: false, error: `Unknown message type: ${msg?.type}` };
  }
}
