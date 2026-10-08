import { describe, test, expect, vi, beforeEach } from 'vitest';
import { isFileSystemAccessSupported, streamChunksToDisk } from '../../src/shared/direct-saver.ts';
import * as storage from '../../src/background/storage.ts';

vi.mock('../../src/background/storage.ts', () => ({
  loadChunk: vi.fn(),
  clearChunks: vi.fn(),
}));

describe('Direct-to-Disk Stream Saver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window = {};
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  test('isFileSystemAccessSupported accurately checks window.showSaveFilePicker', () => {
    // When showSaveFilePicker is not present
    (globalThis as any).window = {};
    expect(isFileSystemAccessSupported()).toBe(false);

    // When showSaveFilePicker is present
    (globalThis as any).window.showSaveFilePicker = vi.fn();
    expect(isFileSystemAccessSupported()).toBe(true);
  });

  test('streamChunksToDisk returns error if File System Access API is not supported', async () => {
    (globalThis as any).window = {};
    const res = await streamChunksToDisk('dl-1', 'test.iso', 2, 2048);
    expect(res.success).toBe(false);
    expect(res.error).toContain('not supported');
  });

  test('streamChunksToDisk handles user cancellation (AbortError) without destroying chunks', async () => {
    (globalThis as any).window.showSaveFilePicker = vi.fn().mockRejectedValue({
      name: 'AbortError',
      message: 'The user aborted a request.',
    });

    const res = await streamChunksToDisk('dl-1', 'Windows10.iso', 4, 4000);
    expect(res.success).toBe(false);
    expect(res.cancelled).toBe(true);
    expect(storage.clearChunks).not.toHaveBeenCalled();
  });

  test('streamChunksToDisk sequentially writes chunks with O(1) memory overhead and tracks progress', async () => {
    const chunk0 = new Uint8Array([1, 2, 3, 4]);
    const chunk1 = new Uint8Array([5, 6, 7, 8]);
    vi.mocked(storage.loadChunk).mockImplementation(async (_id, index) => {
      if (index === 0) return chunk0.buffer;
      if (index === 1) return chunk1.buffer;
      return null;
    });

    const mockWrites: any[] = [];
    const mockWritable = {
      truncate: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockImplementation(async (data) => {
        mockWrites.push(data);
      }),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
    };

    const mockFileHandle = {
      name: 'Windows10.iso',
      createWritable: vi.fn().mockResolvedValue(mockWritable),
      getFile: vi.fn().mockResolvedValue({ size: 8 }),
    };

    (globalThis as any).window.showSaveFilePicker = vi.fn().mockResolvedValue(mockFileHandle);

    const progressReports: number[] = [];
    const res = await streamChunksToDisk(
      'dl-win10',
      'Windows10.iso',
      2,
      8,
      'application/x-iso9660-image',
      (_written, _total, pct) => {
        progressReports.push(pct);
      }
    );

    expect(res.success).toBe(true);
    expect(res.bytesWritten).toBe(8);
    expect(mockWrites.length).toBe(2);
    expect(mockWrites[0].byteLength).toBe(4);
    expect(mockWrites[1].byteLength).toBe(4);
    expect(mockWritable.close).toHaveBeenCalledTimes(1);
    expect(progressReports).toEqual([50, 100]);

    // Critical assertion: clearChunks must NOT be called by streamChunksToDisk
    expect(storage.clearChunks).not.toHaveBeenCalled();
  });

  test('streamChunksToDisk completes successfully even if Windows delays atomic swap rename on close', async () => {
    const chunk0 = new Uint8Array([1, 2, 3, 4]);
    vi.mocked(storage.loadChunk).mockResolvedValue(chunk0.buffer);

    const invalidStateErr = new DOMException(
      'An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk',
      'InvalidStateError'
    );

    const mockWritable = {
      write: vi.fn(),
      close: vi.fn().mockRejectedValue(invalidStateErr),
      abort: vi.fn(),
    };

    const mockFileHandle = {
      name: 'Windows10.iso',
      createWritable: vi.fn().mockResolvedValue(mockWritable),
      getFile: vi.fn().mockResolvedValue({ size: 4 }),
    };

    (globalThis as any).window.showSaveFilePicker = vi.fn().mockResolvedValue(mockFileHandle);

    const res = await streamChunksToDisk('dl-locked', 'Windows10.iso', 1, 4);

    expect(res.success).toBe(true);
    expect(res.bytesWritten).toBe(4);
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalled();
  });

  test('streamChunksToDisk aborts stream safely and preserves chunks if a chunk fails to load', async () => {
    vi.mocked(storage.loadChunk).mockResolvedValue(null);

    const mockWritable = {
      write: vi.fn(),
      close: vi.fn(),
      abort: vi.fn().mockResolvedValue(undefined),
    };

    const mockFileHandle = {
      name: 'Windows10.iso',
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    };

    (globalThis as any).window.showSaveFilePicker = vi.fn().mockResolvedValue(mockFileHandle);

    const res = await streamChunksToDisk('dl-missing', 'Windows10.iso', 2, 8);

    expect(res.success).toBe(false);
    expect(res.error).toContain('Missing chunk segment');
    expect(mockWritable.abort).toHaveBeenCalled();
    expect(storage.clearChunks).not.toHaveBeenCalled();
  });
});
