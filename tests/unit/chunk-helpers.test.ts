import { describe, test, expect } from 'vitest';
import { getVisualChunks, renderChunkDrawerHtml } from '../../src/shared/chunk-helpers.ts';

describe('Chunk Visualization Telemetry & Helpers', () => {
  test('accurately reconstructs multi-segment chunks for completed and active items', () => {
    // 1. Download with live engine segments
    const dlWithSegments = {
      id: 'dl-1',
      total: 10 * 1024 * 1024,
      received: 6 * 1024 * 1024,
      state: 'downloading',
      segments: [
        { index: 0, start: 0, end: 2621439, received: 2621440, done: true },
        { index: 1, start: 2621440, end: 5242879, received: 2621440, done: true },
        { index: 2, start: 5242880, end: 7864319, received: 1048576, done: false },
        { index: 3, start: 7864320, end: 10485759, received: 0, done: false },
      ],
    };

    const chunks = getVisualChunks(dlWithSegments);
    expect(chunks.length).toBe(4);
    expect(chunks[0].status).toBe('done');
    expect(chunks[0].percent).toBe(100);
    expect(chunks[1].status).toBe('done');
    expect(chunks[2].status).toBe('downloading');
    expect(chunks[2].percent).toBeGreaterThan(0);
    expect(chunks[3].status).toBe('pending');
    expect(chunks[3].percent).toBe(0);
  });

  test('reconstructs chunks cleanly from totalChunks and size for cancelled or past items', () => {
    // 2. Cancelled item like wallhaven-d8vdel.jpg from user screenshot
    const cancelledDl = {
      id: 'dl-2',
      filename: 'wallhaven-d8vdel.jpg',
      filesize: 3030000,
      receivedBytes: 1080000,
      state: 'cancelled',
      totalChunks: 4,
    };

    const chunks = getVisualChunks(cancelledDl);
    expect(chunks.length).toBe(4);
    expect(chunks[0].status).toBe('done');
    expect(chunks[0].percent).toBe(100);
    expect(chunks[1].percent).toBeGreaterThan(0);
    expect(chunks[2].percent).toBe(0);
    expect(chunks[3].percent).toBe(0);
  });

  test('renderChunkDrawerHtml produces complete markup with segmented track and thread cards', () => {
    const dl = {
      id: 'dl-3',
      filename: 'installer.exe',
      total: 50 * 1024 * 1024,
      received: 25 * 1024 * 1024,
      state: 'downloading',
      totalChunks: 4,
    };

    const html = renderChunkDrawerHtml(dl);
    expect(html).toContain('chunk-drawer-content');
    expect(html).toContain('4 CHUNKS');
    expect(html).toContain('chunk-done-status');
    expect(html).toContain('chunk-track-strip');
    expect(html).toContain('chunk-threads-grid');
    expect(html).toContain('Thread 1');
    expect(html).toContain('Thread 4');
  });

  test('renderChunkDrawerHtml sets all-done class when all chunks complete', () => {
    const dl = {
      id: 'dl-4',
      filename: 'document.pdf',
      total: 20 * 1024 * 1024,
      received: 20 * 1024 * 1024,
      state: 'completed',
      totalChunks: 4,
    };

    const html = renderChunkDrawerHtml(dl);
    expect(html).toContain('4/4 Done');
    expect(html).toContain('chunk-done-status all-done');
  });
});
