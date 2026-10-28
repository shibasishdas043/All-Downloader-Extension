// ============================================================
//  Unit Tests — Extension Update Manager Service
// ============================================================
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { UpdateManager } from '../../src/background/services/update-manager.js';
import { DEFAULT_SETTINGS, MSG } from '../../src/shared/constants.js';
import type { ExtensionSettings } from '../../src/shared/types.js';

describe('UpdateManager — Auto Update Checks & Lifecycle', () => {
  let mockCoordinator: any;
  let updateMgr: UpdateManager;

  beforeEach(() => {
    vi.useRealTimers();

    mockCoordinator = {
      settings: { ...DEFAULT_SETTINGS } as ExtensionSettings,
      hasActiveDownloads: vi.fn().mockReturnValue(false),
      updateSettings: vi.fn(),
    };

    updateMgr = new UpdateManager();

    (globalThis as any).chrome = {
      runtime: {
        getManifest: vi.fn(() => ({ version: '1.1.0' })),
        requestUpdateCheck: vi.fn(),
        reload: vi.fn(),
        sendMessage: vi.fn(),
        onUpdateAvailable: {
          addListener: vi.fn(),
        },
      },
      alarms: {
        get: vi.fn((_name, cb) => cb(null)),
        create: vi.fn(),
        clear: vi.fn(),
      },
      notifications: {
        create: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('init attaches onUpdateAvailable listener and syncs alarm', () => {
    updateMgr.init(mockCoordinator);

    expect(chrome.runtime.onUpdateAvailable.addListener).toHaveBeenCalled();
    expect(chrome.alarms.get).toHaveBeenCalledWith(UpdateManager.ALARM_NAME, expect.any(Function));
  });

  test('syncAlarm creates alarm when autoCheckUpdates is enabled and clears when disabled', () => {
    updateMgr.init(mockCoordinator);

    mockCoordinator.settings.autoCheckUpdates = true;
    updateMgr.syncAlarm();
    expect(chrome.alarms.create).toHaveBeenCalledWith(UpdateManager.ALARM_NAME, {
      delayInMinutes: 2,
      periodInMinutes: UpdateManager.CHECK_INTERVAL_MINUTES,
    });

    mockCoordinator.settings.autoCheckUpdates = false;
    updateMgr.syncAlarm();
    expect(chrome.alarms.clear).toHaveBeenCalledWith(UpdateManager.ALARM_NAME);
  });

  test('handleAlarm triggers update check on matching alarm name', async () => {
    updateMgr.init(mockCoordinator);
    const checkSpy = vi.spyOn(updateMgr, 'checkForUpdates').mockResolvedValue({
      ok: true,
      status: 'no_update',
      currentVersion: '1.1.0',
      message: 'Up to date',
    });

    const handled = updateMgr.handleAlarm(UpdateManager.ALARM_NAME);
    expect(handled).toBe(true);
    expect(checkSpy).toHaveBeenCalledWith(true);

    const ignored = updateMgr.handleAlarm('other_alarm');
    expect(ignored).toBe(false);
  });

  test('checkForUpdates handles no_update correctly', async () => {
    (chrome.runtime.requestUpdateCheck as any).mockImplementation((cb: Function) => {
      cb('no_update');
    });

    const res = await updateMgr.checkForUpdates(false);
    expect(res.ok).toBe(true);
    expect(res.status).toBe('no_update');
    expect(res.currentVersion).toBe('1.1.0');
    expect(res.message).toContain('latest version');
  });

  test('checkForUpdates handles throttled correctly', async () => {
    (chrome.runtime.requestUpdateCheck as any).mockImplementation((cb: Function) => {
      cb('throttled');
    });

    const res = await updateMgr.checkForUpdates(false);
    expect(res.ok).toBe(true);
    expect(res.status).toBe('throttled');
    expect(res.message).toContain('throttled by Chrome');
  });

  test('checkForUpdates handles update_available and updates pending state', async () => {
    (chrome.runtime.requestUpdateCheck as any).mockImplementation((cb: Function) => {
      cb('update_available', { version: '1.0.8' });
    });

    const res = await updateMgr.checkForUpdates(false);
    expect(res.ok).toBe(true);
    expect(res.status).toBe('update_available');
    expect(res.version).toBe('1.0.8');
    expect(updateMgr.getStatus().pendingVersion).toBe('1.0.8');
  });

  test('checkForUpdates returns error gracefully without throwing when API fails', async () => {
    (chrome.runtime.requestUpdateCheck as any).mockImplementation(() => {
      throw new Error('Web store unreachable');
    });

    const res = await updateMgr.checkForUpdates(false);
    expect(res.ok).toBe(false);
    expect(res.status).toBe('error');
    expect(res.message).toBe('Web store unreachable');
  });

  test('handleUpdateAvailable applies update when idle and defers when busy', () => {
    vi.useFakeTimers();
    mockCoordinator.hasActiveDownloads.mockReturnValue(false);
    updateMgr.init(mockCoordinator);

    updateMgr.handleUpdateAvailable('1.0.8');
    expect(updateMgr.getStatus().pendingVersion).toBe('1.0.8');
    vi.advanceTimersByTime(600);
    expect(chrome.runtime.reload).toHaveBeenCalled();
  });

  test('onDownloadsIdle applies postponed update when active downloads complete', () => {
    vi.useFakeTimers();
    mockCoordinator.hasActiveDownloads.mockReturnValue(true);
    updateMgr.init(mockCoordinator);

    updateMgr.handleUpdateAvailable('1.0.8');
    expect(chrome.runtime.reload).not.toHaveBeenCalled();

    // Now downloads finish:
    mockCoordinator.hasActiveDownloads.mockReturnValue(false);
    updateMgr.onDownloadsIdle();

    vi.advanceTimersByTime(600);
    expect(chrome.runtime.reload).toHaveBeenCalled();
  });

  test('applyUpdate postpones reload if active downloads are in progress', () => {
    mockCoordinator.hasActiveDownloads.mockReturnValue(true);
    updateMgr.init(mockCoordinator);

    const result = updateMgr.applyUpdate();
    expect(result.ok).toBe(false);
    expect(result.postponed).toBe(true);
    expect(result.message).toContain('Active downloads in progress');
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });

  test('applyUpdate invokes chrome.runtime.reload when no active downloads exist', () => {
    vi.useFakeTimers();
    mockCoordinator.hasActiveDownloads.mockReturnValue(false);
    updateMgr.init(mockCoordinator);

    const result = updateMgr.applyUpdate();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Restarting extension');

    vi.advanceTimersByTime(150);
    expect(chrome.runtime.reload).toHaveBeenCalled();
  });
});
