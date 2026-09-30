// ============================================================
//  All-Downloader — Service Worker Message Router
// ============================================================
import { MSG, DOWNLOAD_STATE } from '../../shared/constants.js';
import {
  loadDownloads, getDownload, deleteDownload,
  saveSettings, clearHistory
} from '../storage.js';
import { pauseDownload, cancelDownload } from '../download-engine.js';
import type { DownloadState, ExtensionSettings } from '../../shared/types.js';
import type { DownloadCoordinator } from './download-coordinator.js';
import { openDashboard, broadcastMessage } from './badge-manager.js';

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
      await coordinator.executeDownload(msg.id);
      return { ok: true, queueOrder: coordinator.queue.getStatus().queue };
    }

    case MSG.CLEAR_QUEUE: {
      const ids = coordinator.queue.clear();
      for (const id of ids) {
        await cancelDownload(id);
        await coordinator.updateState(id, DOWNLOAD_STATE.CANCELLED as DownloadState);
        broadcastMessage({ type: MSG.DOWNLOAD_CANCELLED, id });
      }
      return { ok: true, queueOrder: [] };
    }

    case MSG.START_DOWNLOAD: {
      const dl = await coordinator.addDownload(msg.payload || {});
      return { ok: true, download: dl };
    }

    case MSG.PAUSE_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      const state = dl?.status || (dl as any)?.state;
      if (!dl || state !== DOWNLOAD_STATE.DOWNLOADING) return { ok: false };
      pauseDownload(msg.id);
      await coordinator.updateState(msg.id, DOWNLOAD_STATE.PAUSED as DownloadState);
      coordinator.queue.markDone(msg.id);
      broadcastMessage({ type: MSG.DOWNLOAD_PAUSED, id: msg.id });
      return { ok: true };
    }

    case MSG.RESUME_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      const state = dl?.status || (dl as any)?.state;
      if (!dl || state !== DOWNLOAD_STATE.PAUSED) return { ok: false };
      await coordinator.updateState(msg.id, DOWNLOAD_STATE.QUEUED as DownloadState);
      coordinator.queue.enqueue(msg.id);
      return { ok: true };
    }

    case MSG.CANCEL_DOWNLOAD: {
      await cancelDownload(msg.id);
      coordinator.cleanupPending(msg.id);
      await coordinator.updateState(msg.id, DOWNLOAD_STATE.CANCELLED as DownloadState);
      coordinator.queue.remove(msg.id);
      broadcastMessage({ type: MSG.DOWNLOAD_CANCELLED, id: msg.id });
      return { ok: true };
    }

    case MSG.RETRY_DOWNLOAD: {
      const dl = await getDownload(msg.id);
      if (!dl) return { ok: false };
      await coordinator.updateState(msg.id, DOWNLOAD_STATE.QUEUED as DownloadState, {
        errorMessage: null,
        error: null,
        receivedBytes: 0,
        received: 0,
        progress: 0,
        percent: 0,
      } as any);
      coordinator.queue.enqueue(msg.id);
      return { ok: true };
    }

    case MSG.DELETE_DOWNLOAD: {
      await cancelDownload(msg.id);
      coordinator.cleanupPending(msg.id);
      await deleteDownload(msg.id);
      coordinator.queue.remove(msg.id);
      coordinator.downloadCache.delete(msg.id);
      return { ok: true };
    }

    case MSG.GET_SETTINGS: {
      return { ok: true, settings: coordinator.settings };
    }

    case MSG.UPDATE_SETTINGS: {
      const updated = await saveSettings(msg.payload);
      coordinator.updateSettings(updated);
      onSettingsSaved(updated);
      return { ok: true, settings: updated };
    }

    case MSG.CLEAR_HISTORY: {
      await clearHistory();
      return { ok: true };
    }

    case MSG.OPEN_DASHBOARD: {
      openDashboard();
      return { ok: true };
    }

    case MSG.SHOW_IN_FOLDER: {
      const ok = await coordinator.showInFolder(msg.id);
      return { ok };
    }

    default:
      return { ok: false, error: `Unknown message type: ${msg?.type}` };
  }
}
