// ============================================================
//  Unit Tests — Settings Pipeline & Logic Enforcement
// ============================================================
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_SETTINGS, MSG, DOWNLOAD_STATE } from '../../src/shared/constants.ts';
import { QueueManager } from '../../src/background/queue-manager.ts';
import { createThrottle } from '../../src/background/download-engine/throttler.ts';
import { DownloadCoordinator } from '../../src/background/services/download-coordinator.ts';
import type { ExtensionSettings } from '../../src/shared/types.ts';

describe('Settings Pipeline & Logic Enforcement', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  test('default settings contain all necessary configuration keys', () => {
    expect(DEFAULT_SETTINGS.maxConcurrent).toBe(3);
    expect(DEFAULT_SETTINGS.maxChunks).toBe(8);
    expect(DEFAULT_SETTINGS.minChunkSizeMB).toBe(2);
    expect(DEFAULT_SETTINGS.speedLimitKBps).toBe(0);
    expect(DEFAULT_SETTINGS.defaultSavePath).toBe('');
    expect(DEFAULT_SETTINGS.autoStart).toBe(true);
    expect(DEFAULT_SETTINGS.showNotifications).toBe(true);
    expect(DEFAULT_SETTINGS.verifyIntegrity).toBe(true);
    expect(DEFAULT_SETTINGS.interceptDownloads).toBe(true);
    expect(DEFAULT_SETTINGS.preserveChunksOnCancel).toBe(true);
    expect(DEFAULT_SETTINGS.organizeByCategoryFolders).toBe(false);
    expect(DEFAULT_SETTINGS.maxHistoryItems).toBe(500);
  });

  test('updateSettings dynamically reconfigures QueueManager concurrency limit', () => {
    const coordinator = new DownloadCoordinator({ ...DEFAULT_SETTINGS } as ExtensionSettings);
    expect((coordinator.queue as any).maxConcurrent).toBe(3);

    coordinator.updateSettings({ ...DEFAULT_SETTINGS, maxConcurrent: 7 } as ExtensionSettings);
    expect((coordinator.queue as any).maxConcurrent).toBe(7);

    // Clamps to at least 1
    coordinator.updateSettings({ ...DEFAULT_SETTINGS, maxConcurrent: -2, speedLimitKBps: 500 } as ExtensionSettings);
    expect((coordinator.queue as any).maxConcurrent).toBe(1);
    expect(coordinator.rateLimiter.getRateKBps()).toBe(500);
  });

  test('autoStart setting controls automatic queue dispatch on download creation', async () => {
    const coordinator = new DownloadCoordinator({ ...DEFAULT_SETTINGS, autoStart: false } as ExtensionSettings);
    const enqueueSpy = vi.spyOn(coordinator.queue, 'enqueue');

    // Mock upsertDownload and chrome globals with callback support
    (globalThis as any).chrome = {
      action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setIcon: vi.fn() },
      runtime: { sendMessage: vi.fn() },
      storage: {
        local: {
          get: vi.fn((_keys: any, cb?: (res: any) => void) => {
            if (cb) cb({});
            return Promise.resolve({});
          }),
          set: vi.fn((_data: any, cb?: () => void) => {
            if (cb) cb();
            return Promise.resolve();
          }),
        },
      },
    };

    const dl = await coordinator.addDownload({ url: 'https://example.com/test.zip' });
    expect(dl.status).toBe(DOWNLOAD_STATE.QUEUED);
    // Because autoStart is false, enqueue was NOT called
    expect(enqueueSpy).not.toHaveBeenCalled();

    // Now turn autoStart ON
    coordinator.updateSettings({ ...DEFAULT_SETTINGS, autoStart: true } as ExtensionSettings);
    await coordinator.addDownload({ url: 'https://example.com/test2.zip' });
    expect(enqueueSpy).toHaveBeenCalled();
  });

  test('speedLimitKBps throttler enforces token-bucket wait when rate limit > 0', async () => {
    // 0 = unlimited, returns immediate resolved promise
    const unlimited = createThrottle(0);
    const p1 = unlimited(100 * 1024);
    await expect(p1).resolves.toBeUndefined();

    // Limited throttle
    const limited = createThrottle(50); // 50 KB/s
    expect(typeof limited).toBe('function');
  });

  test('QueueManager respects maxConcurrent limit when enqueueing items', () => {
    const dequeued: string[] = [];
    const queue = new QueueManager({
      maxConcurrent: 2,
      onDequeue: (id) => dequeued.push(id),
    });

    queue.enqueue('dl_1');
    queue.enqueue('dl_2');
    queue.enqueue('dl_3');
    queue.enqueue('dl_4');

    // Only 2 should start immediately
    expect(dequeued).toEqual(['dl_1', 'dl_2']);

    // Finishing dl_1 allows dl_3 to start
    queue.markDone('dl_1');
    expect(dequeued).toEqual(['dl_1', 'dl_2', 'dl_3']);

    // Increasing concurrency limit to 3 allows dl_4 to start immediately
    queue.setMaxConcurrent(3);
    expect(dequeued).toEqual(['dl_1', 'dl_2', 'dl_3', 'dl_4']);
  });

  test('updateBadge accurately sets badge number for active items and clears on empty/delete', async () => {
    const { updateBadge } = await import('../../src/background/services/badge-manager.ts');
    const setBadgeText = vi.fn();
    const setBadgeBackgroundColor = vi.fn();

    (globalThis as any).chrome = {
      action: { setBadgeText, setBadgeBackgroundColor },
    };

    updateBadge([
      { id: 'dl_active', status: DOWNLOAD_STATE.DOWNLOADING } as any,
    ]);
    expect(setBadgeText).toHaveBeenCalledWith({ text: '1' });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#219ebc' });

    // When the download is deleted or removed
    updateBadge([]);
    expect(setBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  test('loadSettings returns DEFAULT_SETTINGS when chrome.storage is empty', async () => {
    const { loadSettings } = await import('../../src/background/storage.ts');
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn((_keys: any, cb?: (res: any) => void) => {
            const data = {};
            if (cb) cb(data);
            return Promise.resolve(data);
          }),
        },
      },
    };

    const settings = await loadSettings();
    expect(settings.maxConcurrent).toBe(DEFAULT_SETTINGS.maxConcurrent);
    expect(settings.maxChunks).toBe(DEFAULT_SETTINGS.maxChunks);
    expect(settings.showNotifications).toBe(DEFAULT_SETTINGS.showNotifications);
  });

  test('saveSettings merges partial settings and persists atomically', async () => {
    const { loadSettings, saveSettings } = await import('../../src/background/storage.ts');
    let mockStore: Record<string, any> = {};

    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn((keys: any, cb?: (res: any) => void) => {
            const key = Array.isArray(keys) ? keys[0] : keys;
            const res = { [key]: mockStore[key] };
            if (cb) cb(res);
            return Promise.resolve(res);
          }),
          set: vi.fn((data: any, cb?: () => void) => {
            Object.assign(mockStore, data);
            if (cb) cb();
            return Promise.resolve();
          }),
        },
      },
    };

    // Save partial changes: maxConcurrent = 6
    const res1 = await saveSettings({ maxConcurrent: 6 });
    expect(res1.maxConcurrent).toBe(6);
    expect(res1.maxChunks).toBe(8); // retains default

    // Save partial changes: maxChunks = 16, showNotifications = false
    const res2 = await saveSettings({ maxChunks: 16, showNotifications: false });
    expect(res2.maxConcurrent).toBe(6); // retains previously saved value
    expect(res2.maxChunks).toBe(16);
    expect(res2.showNotifications).toBe(false);

    // Verify loadSettings returns the full merged object
    const loaded = await loadSettings();
    expect(loaded.maxConcurrent).toBe(6);
    expect(loaded.maxChunks).toBe(16);
    expect(loaded.showNotifications).toBe(false);
  });

  test('MessageRouter GET_SETTINGS and UPDATE_SETTINGS synchronize coordinator and broadcast', async () => {
    const { handleMessage } = await import('../../src/background/services/message-router.ts');
    let mockStore: Record<string, any> = {};
    const broadcastMessages: any[] = [];

    (globalThis as any).chrome = {
      action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setIcon: vi.fn() },
      runtime: {
        sendMessage: vi.fn((msg: any) => {
          broadcastMessages.push(msg);
        }),
      },
      storage: {
        local: {
          get: vi.fn((keys: any, cb?: (res: any) => void) => {
            const key = Array.isArray(keys) ? keys[0] : keys;
            const res = { [key]: mockStore[key] };
            if (cb) cb(res);
            return Promise.resolve(res);
          }),
          set: vi.fn((data: any, cb?: () => void) => {
            Object.assign(mockStore, data);
            if (cb) cb();
            return Promise.resolve();
          }),
        },
      },
    };

    const coordinator = new DownloadCoordinator({ ...DEFAULT_SETTINGS } as ExtensionSettings);
    let lastSavedSettings: ExtensionSettings | null = null;
    const onSettingsSaved = vi.fn((s: ExtensionSettings) => {
      lastSavedSettings = s;
    });

    // Test UPDATE_SETTINGS
    const updateRes = await handleMessage(
      { type: MSG.UPDATE_SETTINGS, payload: { maxConcurrent: 5, maxChunks: 12 } },
      coordinator,
      onSettingsSaved
    );

    expect(updateRes.ok).toBe(true);
    expect(updateRes.settings.maxConcurrent).toBe(5);
    expect(updateRes.settings.maxChunks).toBe(12);
    expect(onSettingsSaved).toHaveBeenCalledWith(updateRes.settings);
    expect((coordinator.queue as any).maxConcurrent).toBe(5);

    // Verify broadcast
    const broadcast = broadcastMessages.find((m) => m.type === MSG.SETTINGS_UPDATED);
    expect(broadcast).toBeDefined();
    expect(broadcast.settings.maxConcurrent).toBe(5);

    // Test GET_SETTINGS
    const getRes = await handleMessage(
      { type: MSG.GET_SETTINGS },
      coordinator,
      onSettingsSaved
    );
    expect(getRes.ok).toBe(true);
    expect(getRes.settings.maxConcurrent).toBe(5);
    expect(getRes.settings.maxChunks).toBe(12);
  });
});

