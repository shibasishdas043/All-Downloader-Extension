// ============================================================
//  All-Downloader — Offscreen Document Manager
// ============================================================
import { MSG } from '../../shared/constants.js';

export interface PendingChromeDownload {
  id: string;
  blobUrl: string;
  safeFilename: string;
  fileSize: number;
  targetSavePath?: string;
}

let creatingOffscreenPromise: Promise<void> | null = null;
let activeAssemblies = 0;
const activeRetainers = new Set<string>();
let offscreenCooldownTimer: any = null;

export function retainOffscreenAssembly(id?: string): void {
  if (id) activeRetainers.add(id);
  activeAssemblies++;
  if (offscreenCooldownTimer) {
    clearTimeout(offscreenCooldownTimer);
    offscreenCooldownTimer = null;
  }
}

export function releaseOffscreenAssembly(id?: string): void {
  if (id) activeRetainers.delete(id);
  activeAssemblies = Math.max(0, activeAssemblies - 1);
}

export function getActiveAssembliesCount(): number {
  return Math.max(activeAssemblies, activeRetainers.size);
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCooldownTimer) {
    clearTimeout(offscreenCooldownTimer);
    offscreenCooldownTimer = null;
  }
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

export async function closeOffscreenDocumentIfIdle(hasPending: boolean): Promise<void> {
  if (hasPending || activeAssemblies > 0 || activeRetainers.size > 0) {
    if (offscreenCooldownTimer) {
      clearTimeout(offscreenCooldownTimer);
      offscreenCooldownTimer = null;
    }
    return;
  }

  if (offscreenCooldownTimer) return;

  offscreenCooldownTimer = setTimeout(async () => {
    offscreenCooldownTimer = null;
    if (activeAssemblies > 0 || activeRetainers.size > 0) return;
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
  }, 10_000);
}

export function revokeBlobUrl(blobUrl: string): void {
  try {
    const res = chrome.runtime.sendMessage({
      type: MSG.OFFSCREEN_REVOKE_BLOB_URL,
      blobUrl,
    });
    if (res && typeof res.catch === 'function') {
      res.catch(() => {});
    }
  } catch {
    // Ignore runtime errors
  }
}

export function cleanupPendingChromeDownload(
  downloadId: string,
  pendingChromeDownloads: Map<number, PendingChromeDownload>
): void {
  for (const [chromeDlId, pending] of pendingChromeDownloads.entries()) {
    if (pending.id === downloadId) {
      try {
        const p = chrome.downloads.cancel(chromeDlId);
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      } catch {
        // Ignore
      }
      revokeBlobUrl(pending.blobUrl);
      pendingChromeDownloads.delete(chromeDlId);
      closeOffscreenDocumentIfIdle(pendingChromeDownloads.size > 0).catch(() => {});
      break;
    }
  }
}
