import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  StallError,
  readWithTimeout,
  executeChunkedDownload,
  READ_TIMEOUT_MS,
} from '../../src/background/download-engine/chunked-download.ts';
import { DownloadCoordinator } from '../../src/background/services/download-coordinator.ts';
import * as storage from '../../src/background/storage.ts';
import { DEFAULT_SETTINGS } from '../../src/shared/constants.ts';

vi.mock('../../src/background/storage.ts', () => ({
  loadChunk: vi.fn(),
  saveChunk: vi.fn(),
  clearChunks: vi.fn(),
  upsertDownload: vi.fn(),
  getDownload: vi.fn(),
  loadDownloads: vi.fn(),
  saveDownloads: vi.fn(),
  recordCompletion: vi.fn(),
}));

describe('Network Stall Recovery & Resume Hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('StallError & readWithTimeout', () => {
    test('StallError constructs properly with segmentIndex and bytesAlreadyReceived', () => {
      const err = new StallError(3, 1024 * 1024);
      expect(err.name).toBe('StallError');
      expect(err.segmentIndex).toBe(3);
      expect(err.bytesAlreadyReceived).toBe(1024 * 1024);
      expect(err.message).toContain('Segment 3 stalled');
    });

    test('readWithTimeout resolves immediately when reader returns data before timeout', async () => {
      const mockValue = new Uint8Array([1, 2, 3]);
      const mockReader = {
        read: vi.fn().mockResolvedValue({ done: false, value: mockValue }),
      } as any;

      const controller = new AbortController();
      const res = await readWithTimeout(mockReader, 1000, controller.signal);

      expect(res.done).toBe(false);
      expect(res.value).toEqual(mockValue);
    });

    test('readWithTimeout throws TimeoutError when reader hangs beyond deadline', async () => {
      const hangingReader = {
        read: vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves
      } as any;

      const controller = new AbortController();
      await expect(readWithTimeout(hangingReader, 50, controller.signal)).rejects.toThrow('Read stalled');
    });

    test('readWithTimeout throws AbortError when controller signal is aborted', async () => {
      const hangingReader = {
        read: vi.fn().mockImplementation(() => new Promise(() => {})),
      } as any;

      const controller = new AbortController();
      const promise = readWithTimeout(hangingReader, 5000, controller.signal);
      controller.abort();

      await expect(promise).rejects.toThrow('Aborted');
    });
  });

  describe('Upfront Storage Verification & Hydration Phase', () => {
    test('pre-hydrates progress.received and marks completed chunks as done before downloading', async () => {
      const totalSize = 4 * 1024 * 1024; // 4MB
      const chunkSize = 1024 * 1024; // 1MB per chunk (4 chunks)
      const download = {
        id: 'dl-resume-test',
        url: 'https://example.com/large.iso',
        filename: 'large.iso',
      } as any;

      // Mock chunks 0 and 1 already existing in storage (2MB verified)
      vi.mocked(storage.loadChunk).mockImplementation(async (_id, index) => {
        if (index === 0) return { size: chunkSize } as any;
        if (index === 1) return { size: chunkSize } as any;
        return null;
      });

      const progress = {
        received: 0,
        total: totalSize,
        lastBroadcast: 0,
      };

      const emittedSegments: any[] = [];
      const emit = vi.fn((segs?: any[]) => {
        if (segs) emittedSegments.push([...segs]);
      });

      const controller = new AbortController();
      // Abort after verification to stop worker fetching
      controller.abort();

      try {
        await executeChunkedDownload({
          download,
          totalSize,
          mimeType: 'application/octet-stream',
          settings: { ...DEFAULT_SETTINGS, maxChunks: 4, minChunkSizeMB: 1 } as any,
          controller,
          throttle: async () => {},
          progress,
          emit,
        });
      } catch (err: any) {
        // AbortError is expected since we stopped workers
        expect(err.name).toBe('AbortError');
      }

      // Crucial: progress.received was immediately hydrated to 2MB (chunks 0 and 1)
      expect(progress.received).toBe(2 * chunkSize);
      expect(emit).toHaveBeenCalled();

      // Verified segments 0 and 1 are marked done: true with received = 1MB
      const initialEmit = emittedSegments[0];
      expect(initialEmit).toBeDefined();
      expect(initialEmit[0].done).toBe(true);
      expect(initialEmit[0].received).toBe(chunkSize);
      expect(initialEmit[1].done).toBe(true);
      expect(initialEmit[1].received).toBe(chunkSize);
      expect(initialEmit[2].done).toBe(false);
      expect(initialEmit[3].done).toBe(false);
    });
  });

  describe('DownloadCoordinator Auto-Retry Budget & Error Classification', () => {
    test('isNetworkError correctly identifies connection losses, stalls, and timeouts', () => {
      const coordinator = new DownloadCoordinator({ ...DEFAULT_SETTINGS } as any);

      expect(coordinator.isNetworkError('Failed to fetch')).toBe(true);
      expect(coordinator.isNetworkError('Segment 2 stalled — no bytes received for 30s')).toBe(true);
      expect(coordinator.isNetworkError('Network error: connection reset by peer')).toBe(true);
      expect(coordinator.isNetworkError('ECONNRESET')).toBe(true);
      expect(coordinator.isNetworkError('ETIMEDOUT')).toBe(true);
      expect(coordinator.isNetworkError('HTTP 500 Internal Server Error')).toBe(false);
      expect(coordinator.isNetworkError('HTTP 404 Not Found')).toBe(false);
    });

    test('autoRetryBudget tracks retries up to 5 attempts with exponential delay', () => {
      const coordinator = new DownloadCoordinator({ ...DEFAULT_SETTINGS } as any);
      expect(DownloadCoordinator.MAX_AUTO_RETRIES).toBe(5);
      expect(DownloadCoordinator.AUTO_RETRY_DELAYS).toEqual([3000, 8000, 20000, 60000, 120000]);

      coordinator.autoRetryBudget.set('dl-1', 1);
      expect(coordinator.autoRetryBudget.get('dl-1')).toBe(1);

      coordinator.autoRetryBudget.delete('dl-1');
      expect(coordinator.autoRetryBudget.has('dl-1')).toBe(false);
    });
  });
});
