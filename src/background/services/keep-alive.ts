// ============================================================
//  All-Downloader — Service Worker Keep-Alive Guard
//  Prevents Manifest V3 background service workers from premature
//  termination during multi-gigabyte or overnight file downloads.
// ============================================================

export class ServiceWorkerKeepAliveGuard {
  private activeCount = 0;
  private intervalTimer: any = null;
  private static readonly ALARM_NAME = 'adl_sw_keepalive';
  private static readonly HEARTBEAT_INTERVAL_MS = 20_000;

  public retain(): void {
    this.activeCount++;
    if (this.activeCount === 1) {
      this.startHeartbeat();
    }
  }

  public release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    if (this.activeCount === 0) {
      this.stopHeartbeat();
    }
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  private startHeartbeat(): void {
    if (this.intervalTimer) return;

    // 1. Register a repeating alarm anchor
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      try {
        chrome.alarms.create(ServiceWorkerKeepAliveGuard.ALARM_NAME, {
          periodInMinutes: 1,
        });
      } catch {
        // ignore
      }
    }

    // 2. High-frequency API pulse to reset Chromium MV3 idle countdown
    this.intervalTimer = setInterval(() => {
      if (this.activeCount <= 0) {
        this.stopHeartbeat();
        return;
      }

      if (typeof chrome !== 'undefined' && chrome.runtime?.getPlatformInfo) {
        chrome.runtime.getPlatformInfo(() => {
          /* active API call resets worker idle timer */
        });
      }
    }, ServiceWorkerKeepAliveGuard.HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      try {
        chrome.alarms.clear(ServiceWorkerKeepAliveGuard.ALARM_NAME);
      } catch {
        // ignore
      }
    }
  }

  public handleAlarm(alarmName: string): boolean {
    if (alarmName === ServiceWorkerKeepAliveGuard.ALARM_NAME) {
      if (this.activeCount > 0) {
        // Ping API to stay awake
        if (typeof chrome !== 'undefined' && chrome.runtime?.getPlatformInfo) {
          chrome.runtime.getPlatformInfo(() => {});
        }
      } else {
        this.stopHeartbeat();
      }
      return true;
    }
    return false;
  }
}

export const keepAliveGuard = new ServiceWorkerKeepAliveGuard();
