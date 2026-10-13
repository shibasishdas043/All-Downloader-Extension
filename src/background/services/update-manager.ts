// ============================================================
//  All-Downloader — Extension Update Manager Service
//  Manages extension update checks, lifecycle, and safe reload
//  coordination without disrupting active chunk downloads.
// ============================================================
import { MSG } from '../../shared/constants.js';
import { broadcastMessage, showNotification } from './badge-manager.js';
import type { DownloadCoordinator } from './download-coordinator.js';
import type { UpdateCheckResult, UpdateStatus } from '../../shared/types.js';

export class UpdateManager {
  public static readonly ALARM_NAME = 'adl_auto_update_check';
  // Periodic background check interval: 24 hours (1440 minutes)
  public static readonly CHECK_INTERVAL_MINUTES = 1440;

  private coordinator: DownloadCoordinator | null = null;
  private pendingUpdateVersion: string | null = null;
  private pendingUpdateAt: number | null = null;
  private lastCheckTime: number | null = null;
  private lastCheckStatus: string | null = null;
  private lastCheckMessage: string | null = null;
  private isChecking = false;

  public init(coordinator: DownloadCoordinator): void {
    this.coordinator = coordinator;
    this.coordinator.onIdle = () => this.onDownloadsIdle();

    // 1. Listen for new update packages downloaded and ready to apply
    if (typeof chrome !== 'undefined' && chrome.runtime?.onUpdateAvailable) {
      try {
        chrome.runtime.onUpdateAvailable.addListener((details) => {
          this.handleUpdateAvailable(details?.version || '');
        });
      } catch (err) {
        console.warn('[ADL Update] Failed to attach onUpdateAvailable listener:', err);
      }
    }

    // 2. Synchronize periodic alarm check based on settings
    this.syncAlarm();
  }

  public syncAlarm(): void {
    if (typeof chrome === 'undefined' || !chrome.alarms) return;
    const isAutoCheckEnabled = this.coordinator?.settings?.autoCheckUpdates !== false;

    if (isAutoCheckEnabled) {
      chrome.alarms.get(UpdateManager.ALARM_NAME, (existing) => {
        if (!existing) {
          // Delay initial check by 2 minutes after startup so boot sequence remains fast
          chrome.alarms.create(UpdateManager.ALARM_NAME, {
            delayInMinutes: 2,
            periodInMinutes: UpdateManager.CHECK_INTERVAL_MINUTES,
          });
        }
      });
    } else {
      chrome.alarms.clear(UpdateManager.ALARM_NAME);
    }
  }

  public handleAlarm(alarmName: string): boolean {
    if (alarmName === UpdateManager.ALARM_NAME) {
      this.checkForUpdates(true).catch((err) => {
        console.warn('[ADL Update] Background check error:', err);
      });
      return true;
    }
    return false;
  }

  public handleUpdateAvailable(version: string): void {
    console.log(`[ADL Update] New extension version ready to install: v${version}`);
    this.pendingUpdateVersion = version || 'available';
    this.pendingUpdateAt = Date.now();

    const isBusy = this.coordinator ? this.coordinator.hasActiveDownloads() : false;
    if (!isBusy) {
      console.log('[ADL Update] No active downloads. Silently applying update in background...');
      this.applyUpdate();
    } else {
      console.log('[ADL Update] Active downloads in progress. Deferring update until downloads complete.');
    }
  }

  public onDownloadsIdle(): void {
    if (this.pendingUpdateVersion && this.coordinator && !this.coordinator.hasActiveDownloads()) {
      console.log(`[ADL Update] Downloads completed and idle. Silently applying update v${this.pendingUpdateVersion}...`);
      this.applyUpdate();
    }
  }

  public async checkForUpdates(silent = false): Promise<UpdateCheckResult> {
    const currentVersion = typeof chrome !== 'undefined' && chrome.runtime?.getManifest
      ? chrome.runtime.getManifest().version
      : '1.0.9';

    if (this.isChecking) {
      return {
        ok: true,
        status: 'checking',
        currentVersion,
        message: 'Update check already in progress...',
      };
    }

    this.isChecking = true;
    this.lastCheckTime = Date.now();

    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.requestUpdateCheck) {
        const msg = 'Update checks are not supported in this runtime environment.';
        this.lastCheckStatus = 'unsupported';
        this.lastCheckMessage = msg;
        return {
          ok: false,
          status: 'unsupported',
          currentVersion,
          message: msg,
        };
      }

      const res = await new Promise<{ status: string; details?: { version: string }; error?: string }>((resolve) => {
        try {
          chrome.runtime.requestUpdateCheck((status, details) => {
            if (chrome.runtime?.lastError) {
              const errMsg = chrome.runtime.lastError.message || 'Update check error';
              console.warn('[ADL Update] requestUpdateCheck warning:', errMsg);
              resolve({ status: 'error', error: errMsg });
              return;
            }
            resolve({ status, details });
          });
        } catch (err: any) {
          console.warn('[ADL Update] requestUpdateCheck exception:', err);
          resolve({ status: 'error', error: err?.message || 'Update check failed' });
        }
      });

      this.lastCheckStatus = res.status;

      if (res.status === 'error' || res.error) {
        const message = res.error || 'Failed to check for updates';
        this.lastCheckMessage = message;
        return {
          ok: false,
          status: 'error',
          currentVersion,
          message,
        };
      }

      if (res.status === 'update_available') {
        const newVer = res.details?.version || 'new';
        this.pendingUpdateVersion = newVer;
        this.pendingUpdateAt = Date.now();
        const message = `A new version (v${newVer}) is available and downloading.`;
        this.lastCheckMessage = message;
        if (!silent) console.log(`[ADL Update] ${message}`);
        return {
          ok: true,
          status: 'update_available',
          version: newVer,
          currentVersion,
          message,
        };
      }

      if (res.status === 'throttled') {
        const message = 'Update check was throttled by Chrome. Please try again in a few minutes.';
        this.lastCheckMessage = message;
        return {
          ok: true,
          status: 'throttled',
          currentVersion,
          message,
        };
      }

      if (res.status === 'no_update') {
        const message = `You are on the latest version (v${currentVersion}).`;
        this.lastCheckMessage = message;
        return {
          ok: true,
          status: 'no_update',
          currentVersion,
          message,
        };
      }

      const message = `Check returned status: ${res.status}`;
      this.lastCheckMessage = message;
      return {
        ok: true,
        status: res.status,
        currentVersion,
        message,
      };
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to check for updates';
      this.lastCheckStatus = 'error';
      this.lastCheckMessage = errMsg;
      return {
        ok: false,
        status: 'error',
        currentVersion,
        message: errMsg,
      };
    } finally {
      this.isChecking = false;
    }
  }

  public applyUpdate(): { ok: boolean; message: string; postponed?: boolean } {
    if (this.coordinator?.hasActiveDownloads()) {
      return {
        ok: false,
        postponed: true,
        message: 'Active downloads in progress. Please pause or wait for them to finish before updating.',
      };
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.reload) {
      console.log('[ADL Update] Applying update and reloading extension service worker...');
      setTimeout(() => {
        try {
          chrome.runtime.reload();
        } catch (err) {
          console.error('[ADL Update] Failed to reload extension:', err);
        }
      }, 100);

      return {
        ok: true,
        message: 'Restarting extension to apply update...',
      };
    }

    return {
      ok: false,
      message: 'Extension reload is not supported in this runtime environment.',
    };
  }

  public getStatus(): UpdateStatus {
    const currentVersion = typeof chrome !== 'undefined' && chrome.runtime?.getManifest
      ? chrome.runtime.getManifest().version
      : '1.0.9';

    return {
      currentVersion,
      pendingVersion: this.pendingUpdateVersion,
      pendingAt: this.pendingUpdateAt,
      lastCheckTime: this.lastCheckTime,
      lastCheckStatus: this.lastCheckStatus,
      lastCheckMessage: this.lastCheckMessage,
      hasActiveDownloads: this.coordinator?.hasActiveDownloads() ?? false,
    };
  }
}

export const updateManager = new UpdateManager();
