// ============================================================
//  Unit Tests — Dynamic Interception & Save Resolution Pipeline
// ============================================================
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_SETTINGS, DOWNLOAD_STATE } from '../../src/shared/constants.ts';
import { DownloadCoordinator } from '../../src/background/services/download-coordinator.ts';
import type { ExtensionSettings } from '../../src/shared/types.ts';

describe('Dynamic, Format-Agnostic Interception for All Downloads', () => {
  let coordinator: DownloadCoordinator;

  beforeEach(() => {
    (globalThis as any).chrome = {
      action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setIcon: vi.fn() },
      runtime: { id: 'test-extension-id', sendMessage: vi.fn() },
      downloads: {
        cancel: vi.fn((_id, cb) => cb && cb()),
        erase: vi.fn(),
        search: vi.fn(),
        download: vi.fn(),
      },
      tabs: {
        query: vi.fn().mockResolvedValue([]),
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    };

    coordinator = new DownloadCoordinator({
      ...DEFAULT_SETTINGS,
      interceptDownloads: true,
    } as ExtensionSettings);
  });

  test('intercepts any file regardless of size (small 100KB file)', async () => {
    const addDownloadSpy = vi.spyOn(coordinator, 'addDownload').mockResolvedValue({} as any);

    await coordinator.handleChromeDownloadCreated({
      id: 101,
      url: 'https://example.com/receipt.pdf',
      filename: 'receipt.pdf',
      totalBytes: 100 * 1024,
      fileSize: 100 * 1024,
      mime: 'application/pdf',
    } as any);

    expect(chrome.downloads.cancel).toHaveBeenCalledWith(101, expect.any(Function));
    expect(addDownloadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/receipt.pdf', filename: 'receipt.pdf' })
    );
  });

  test('intercepts any file regardless of extension (future / custom formats)', async () => {
    const addDownloadSpy = vi.spyOn(coordinator, 'addDownload').mockResolvedValue({} as any);

    await coordinator.handleChromeDownloadCreated({
      id: 102,
      url: 'https://example.com/weights.safetensors',
      filename: 'weights.safetensors',
      totalBytes: 50_000_000,
      fileSize: 50_000_000,
    } as any);

    expect(chrome.downloads.cancel).toHaveBeenCalledWith(102, expect.any(Function));
    expect(addDownloadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/weights.safetensors', filename: 'weights.safetensors' })
    );
  });

  test('adopts large files (> 1.5GB) directly into native stream without cancel to prevent system busy', async () => {
    const addDownloadSpy = vi.spyOn(coordinator, 'addDownload').mockResolvedValue({} as any);

    await coordinator.handleChromeDownloadCreated({
      id: 104,
      url: 'https://example.com/archive.tar.gz',
      filename: 'archive.tar.gz',
      totalBytes: 4_000_000_000,
      fileSize: 4_000_000_000,
    } as any);

    // Should NOT cancel Chrome download — adopts directly to prevent FILE_TRANSIENT_ERROR / system busy
    expect(chrome.downloads.cancel).not.toHaveBeenCalled();
    expect(addDownloadSpy).not.toHaveBeenCalled();
  });

  test('bypasses right-click user-initiated downloads', async () => {
    const addDownloadSpy = vi.spyOn(coordinator, 'addDownload');

    // Simulate right-click event recorded
    coordinator.rightClickDetector.record(['https://example.com/image.png'], 'https://example.com/page');

    await coordinator.handleChromeDownloadCreated({
      id: 103,
      url: 'https://example.com/image.png',
      filename: 'image.png',
    } as any);

    // Cancel was NOT called because right-click was detected
    expect(chrome.downloads.cancel).not.toHaveBeenCalled();
    expect(addDownloadSpy).not.toHaveBeenCalled();
  });
});

describe('Filename & Path Determination via onDeterminingFilename & pendingBlobSaves', () => {
  let coordinator: DownloadCoordinator;

  beforeEach(() => {
    coordinator = new DownloadCoordinator({ ...DEFAULT_SETTINGS } as ExtensionSettings);
  });

  test('suggests targetSavePath with conflictAction uniquify using pendingBlobSaves', () => {
    coordinator.pendingBlobSaves.set('blob:chrome-extension://adl/test-blob', {
      id: 'dl_abc',
      blobUrl: 'blob:chrome-extension://adl/test-blob',
      safeFilename: 'custom-file.pkg',
      fileSize: 100_000_000,
      targetSavePath: 'AllDownloader/custom-file.pkg',
    });

    const suggestSpy = vi.fn();
    const handled = coordinator.handleDeterminingFilename(
      { id: 555, url: 'blob:chrome-extension://adl/test-blob' } as any,
      suggestSpy
    );

    expect(handled).toBe(true);
    expect(suggestSpy).toHaveBeenCalledWith({
      filename: 'AllDownloader/custom-file.pkg',
      conflictAction: 'uniquify',
    });
  });

  test('falls back to default suggest() for non-ADL downloads', () => {
    const suggestSpy = vi.fn();
    const handled = coordinator.handleDeterminingFilename(
      { id: 999, url: 'https://example.com/external.zip' } as any,
      suggestSpy
    );

    expect(handled).toBe(false);
    expect(suggestSpy).toHaveBeenCalledWith();
  });
});

describe('Zero-Data-Loss Chunk Resilience & Actual Disk Path Persistence', () => {
  let coordinator: DownloadCoordinator;

  beforeEach(() => {
    (globalThis as any).chrome = {
      action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setIcon: vi.fn() },
      runtime: { sendMessage: vi.fn() },
      downloads: {
        search: vi.fn().mockResolvedValue([
          { id: 888, filename: 'D:\\downloads\\custom_folder\\my-archive.zip', fileSize: 500_000_000 }
        ]),
      },
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

    coordinator = new DownloadCoordinator({
      ...DEFAULT_SETTINGS,
      preserveChunksOnCancel: true,
    } as ExtensionSettings);
  });

  test('preserves chunks and marks isReadyToSave when user cancels Save As dialog', async () => {
    coordinator.pendingChromeDownloads.set(777, {
      id: 'dl_user_cancel',
      blobUrl: 'blob:test/123',
      safeFilename: 'large_archive.zip',
      fileSize: 1024 * 1024 * 500,
      targetSavePath: 'large_archive.zip',
    });
    coordinator.pendingBlobSaves.set('blob:test/123', {
      id: 'dl_user_cancel',
      targetSavePath: 'large_archive.zip',
      safeFilename: 'large_archive.zip',
      fileSize: 1024 * 1024 * 500,
    });

    const updateStateSpy = vi.spyOn(coordinator, 'updateState').mockResolvedValue({} as any);

    await coordinator.handleChromeDownloadChange({
      id: 777,
      state: { current: 'interrupted', previous: 'in_progress' },
      error: { current: 'USER_CANCELED', previous: undefined },
    } as any);

    expect(updateStateSpy).toHaveBeenCalledWith(
      'dl_user_cancel',
      DOWNLOAD_STATE.PAUSED,
      expect.objectContaining({
        isReadyToSave: true,
        percent: 100,
      })
    );
    expect(coordinator.pendingBlobSaves.has('blob:test/123')).toBe(false);
  });

  test('captures actual disk save path chosen by user in the native Save As dialog', async () => {
    coordinator.pendingChromeDownloads.set(888, {
      id: 'dl_save_path_test',
      blobUrl: 'blob:test/456',
      safeFilename: 'my-archive.zip',
      fileSize: 500_000_000,
      targetSavePath: 'AllDownloader/my-archive.zip',
    });

    const updateStateSpy = vi.spyOn(coordinator, 'updateState').mockResolvedValue({} as any);

    await coordinator.handleChromeDownloadChange({
      id: 888,
      state: { current: 'complete', previous: 'in_progress' },
    } as any);

    expect(updateStateSpy).toHaveBeenCalledWith(
      'dl_save_path_test',
      DOWNLOAD_STATE.COMPLETED,
      expect.objectContaining({
        savePath: 'D:\\downloads\\custom_folder\\my-archive.zip',
        filename: 'my-archive.zip',
      })
    );
  });
});
