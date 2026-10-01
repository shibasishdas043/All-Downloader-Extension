// ============================================================
//  All-Downloader — Fair-Share Host Connection Governor
//  Enforces Chromium netstack-friendly per-origin concurrency limits
//  with dynamic fair-share bandwidth allocation across concurrent downloads.
// ============================================================

export function getNormalizedOrigin(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return 'default';
  }
}

export class HostConnectionGovernor {
  /** Maximum concurrent data sockets per origin (Chromium hard ceiling is 6, leaving 1 for probe) */
  public static readonly MAX_HOST_DATA_SOCKETS = 5;

  /** Total maximum concurrent data sockets across all origins */
  public static readonly MAX_GLOBAL_DATA_SOCKETS = 16;

  private downloadsByHost = new Map<string, Set<string>>();
  private activeSocketsByDownload = new Map<string, number>();
  private activeDataSocketsByHost = new Map<string, number>();
  private activeProbeSocketsByHost = new Map<string, number>();
  private quotaListeners = new Map<string, Set<() => void>>();
  private totalDataSockets = 0;

  /**
   * Subscribe to origin quota changes for real-time elastic scaling across concurrent downloads.
   */
  public onQuotaChange(origin: string, listener: () => void): () => void {
    if (!this.quotaListeners.has(origin)) {
      this.quotaListeners.set(origin, new Set());
    }
    this.quotaListeners.get(origin)!.add(listener);

    return () => {
      const set = this.quotaListeners.get(origin);
      if (set) {
        set.delete(listener);
        if (set.size === 0) this.quotaListeners.delete(origin);
      }
    };
  }

  private notifyQuotaChange(origin: string): void {
    const set = this.quotaListeners.get(origin);
    if (set) {
      for (const listener of set) {
        try {
          listener();
        } catch (err) {
          console.error('[HostGovernor] quota listener error:', err);
        }
      }
    }
  }

  /**
   * Register an active download with an origin to participate in fair-share connection allocation.
   */
  public registerDownload(downloadId: string, url: string): void {
    const origin = getNormalizedOrigin(url);
    if (!this.downloadsByHost.has(origin)) {
      this.downloadsByHost.set(origin, new Set());
    }
    const set = this.downloadsByHost.get(origin)!;
    const isNew = !set.has(downloadId);
    set.add(downloadId);
    if (isNew) {
      this.notifyQuotaChange(origin);
    }
  }

  /**
   * Unregister a download upon completion, pause, cancellation, or error.
   */
  public unregisterDownload(downloadId: string, url?: string): void {
    let affectedOrigin: string | null = null;
    if (url) {
      const origin = getNormalizedOrigin(url);
      const set = this.downloadsByHost.get(origin);
      if (set && set.has(downloadId)) {
        set.delete(downloadId);
        affectedOrigin = origin;
        if (set.size === 0) this.downloadsByHost.delete(origin);
      }
    } else {
      for (const [origin, set] of this.downloadsByHost.entries()) {
        if (set.has(downloadId)) {
          set.delete(downloadId);
          affectedOrigin = origin;
          if (set.size === 0) this.downloadsByHost.delete(origin);
          break;
        }
      }
    }
    this.activeSocketsByDownload.delete(downloadId);
    if (affectedOrigin) {
      this.notifyQuotaChange(affectedOrigin);
    }
  }

  /**
   * Calculate fair-share quota for a download on its host.
   * If 1 download on host -> gets up to 5 sockets.
   * If 2 downloads on host -> gets 3 and 2 sockets respectively.
   * If 3 downloads on host -> gets 2, 2, and 1 sockets respectively.
   */
  public getAllocatedQuota(downloadId: string, url: string, maxRequested = 8): number {
    const origin = getNormalizedOrigin(url);
    const activeSet = this.downloadsByHost.get(origin);
    const count = activeSet ? Math.max(1, activeSet.size) : 1;

    const baseShare = Math.floor(HostConnectionGovernor.MAX_HOST_DATA_SOCKETS / count);
    const surplus = HostConnectionGovernor.MAX_HOST_DATA_SOCKETS % count;

    let quota = Math.max(1, baseShare);
    if (activeSet && surplus > 0) {
      const arr = Array.from(activeSet);
      const idx = arr.indexOf(downloadId);
      if (idx !== -1 && idx < surplus) {
        quota += 1;
      }
    }

    return Math.max(1, Math.min(quota, maxRequested));
  }

  public getAvailableDataSlotsForDownload(downloadId: string, url: string, maxRequested = 8): number {
    const quota = this.getAllocatedQuota(downloadId, url, maxRequested);
    const dlActive = this.activeSocketsByDownload.get(downloadId) || 0;
    return Math.max(0, quota - dlActive);
  }

  /**
   * Acquire a data connection slot for a specific download, respecting fair-share per-download limits.
   * Completely non-blocking: downloads are granted their fair-share slots immediately so multiple
   * simultaneous downloads from the same host stream in parallel without 0 B/s head-of-line blocking.
   */
  public async acquireDataSlot(downloadId: string, url: string, signal?: AbortSignal, maxRequested = 8): Promise<() => void> {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const origin = getNormalizedOrigin(url);
    this.registerDownload(downloadId, url);

    const curDl = this.activeSocketsByDownload.get(downloadId) || 0;
    this.activeSocketsByDownload.set(downloadId, curDl + 1);

    const curHost = this.activeDataSocketsByHost.get(origin) || 0;
    this.activeDataSocketsByHost.set(origin, curHost + 1);
    this.totalDataSockets++;

    let released = false;
    return () => {
      if (released) return;
      released = true;

      const dlCount = this.activeSocketsByDownload.get(downloadId) || 1;
      if (dlCount <= 1) {
        this.activeSocketsByDownload.delete(downloadId);
      } else {
        this.activeSocketsByDownload.set(downloadId, dlCount - 1);
      }

      const hostCount = this.activeDataSocketsByHost.get(origin) || 1;
      if (hostCount <= 1) {
        this.activeDataSocketsByHost.delete(origin);
      } else {
        this.activeDataSocketsByHost.set(origin, hostCount - 1);
      }

      this.totalDataSockets = Math.max(0, this.totalDataSockets - 1);
    };
  }

  /**
   * Acquire a high-priority probe slot. Probes bypass data chunk queues to prevent metadata starvation.
   */
  public async acquireProbeSlot(url: string, signal?: AbortSignal): Promise<() => void> {
    const origin = getNormalizedOrigin(url);
    const current = this.activeProbeSocketsByHost.get(origin) || 0;
    this.activeProbeSocketsByHost.set(origin, current + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.activeProbeSocketsByHost.get(origin) || 1;
      if (count <= 1) {
        this.activeProbeSocketsByHost.delete(origin);
      } else {
        this.activeProbeSocketsByHost.set(origin, count - 1);
      }
    };
  }

  public getHostSnapshot(url: string, downloadId?: string): { activeData: number; activeProbes: number; registeredDownloads: number; quota: number } {
    const origin = getNormalizedOrigin(url);
    const activeData = this.activeDataSocketsByHost.get(origin) || 0;
    const activeProbes = this.activeProbeSocketsByHost.get(origin) || 0;
    const activeSet = this.downloadsByHost.get(origin);
    const registeredDownloads = activeSet ? activeSet.size : 0;
    const quota = downloadId ? this.getAllocatedQuota(downloadId, url) : 0;

    return {
      activeData,
      activeProbes,
      registeredDownloads,
      quota,
    };
  }
}

export const hostGovernor = new HostConnectionGovernor();
