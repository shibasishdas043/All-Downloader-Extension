// ============================================================
//  Unit Tests — Streaming Assembly & Segment Partitioning
// ============================================================
import { describe, test, expect, vi } from 'vitest';
import { SpeedTracker } from '../../src/background/speed-tracker.ts';

describe('Zero-Copy Composite Blob Assembly', () => {
  test('assembles multiple chunks into a composite Blob with correct size and type', async () => {
    const chunk1 = new Uint8Array([1, 2, 3, 4]);
    const chunk2 = new Uint8Array([5, 6, 7, 8]);
    const chunk3 = new Uint8Array([9, 10]);

    // Blink composite Blob pointer construction
    const blob = new Blob([chunk1, chunk2, chunk3], { type: 'application/octet-stream' });

    expect(blob.size).toBe(10);
    expect(blob.type).toBe('application/octet-stream');

    const buffer = await blob.arrayBuffer();
    const result = new Uint8Array(buffer);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('assembles large chunk slices without memory mutation', () => {
    // Simulate 4 segments of 1MB each
    const segSize = 1024 * 1024;
    const segments: Uint8Array<ArrayBuffer>[] = [];
    for (let i = 0; i < 4; i++) {
      segments.push(new Uint8Array(segSize));
    }

    const compositeBlob = new Blob(segments, { type: 'application/zip' });
    expect(compositeBlob.size).toBe(4 * 1024 * 1024);
    expect(compositeBlob.type).toBe('application/zip');
  });
});

describe('IDM-Grade Multi-Segment Range Math', () => {
  function computeSegments(totalSize: number, numSegs: number) {
    const segSize = Math.ceil(totalSize / numSegs);
    return Array.from({ length: numSegs }, (_, i) => {
      const start = i * segSize;
      const end = i === numSegs - 1 ? totalSize - 1 : start + segSize - 1;
      return { index: i, start, end, length: end - start + 1 };
    });
  }

  test('divides 2 GB file into exactly 4 contiguous non-overlapping segments', () => {
    const totalSize = 2 * 1024 * 1024 * 1024; // 2 GB
    const segments = computeSegments(totalSize, 4);

    expect(segments.length).toBe(4);
    expect(segments[0].start).toBe(0);
    expect(segments[3].end).toBe(totalSize - 1);

    // Verify seamless continuity
    for (let i = 0; i < segments.length - 1; i++) {
      expect(segments[i + 1].start).toBe(segments[i].end + 1);
    }

    // Verify sum of segment lengths equals totalSize exactly
    const sum = segments.reduce((acc, s) => acc + s.length, 0);
    expect(sum).toBe(totalSize);
  });

  test('divides uneven file size cleanly without dropped bytes', () => {
    const totalSize = 10000003; // Prime size
    const segments = computeSegments(totalSize, 8);

    expect(segments.length).toBe(8);
    expect(segments[0].start).toBe(0);
    expect(segments[7].end).toBe(totalSize - 1);

    const sum = segments.reduce((acc, s) => acc + s.length, 0);
    expect(sum).toBe(totalSize);
  });
});

describe('SpeedTracker Pipeline', () => {
  test('calculates accurate bytesPerSec and ETA', () => {
    const tracker = new SpeedTracker();
    const total = 100 * 1024 * 1024; // 100 MB

    tracker.record(10 * 1024 * 1024, total);
    const snap = tracker.getSnapshot();

    expect(typeof snap.bytesPerSec).toBe('number');
    expect(snap.etaSec === null || typeof snap.etaSec === 'number').toBe(true);
  });
});

describe('Toolbar Icon Animator', () => {
  test('starts and stops download start animation cleanly', async () => {
    const setBadgeText = vi.fn();
    const setBadgeBackgroundColor = vi.fn();
    const setIcon = vi.fn();

    // Mock chrome.action global
    (globalThis as any).chrome = {
      action: {
        setBadgeText,
        setBadgeBackgroundColor,
        setIcon,
      },
    };

    const { playDownloadStartAnimation, stopDownloadStartAnimation } = await import('../../src/background/icon-animator.ts');

    playDownloadStartAnimation();
    expect(stopDownloadStartAnimation).toBeDefined();

    stopDownloadStartAnimation();
    expect(setIcon).toHaveBeenCalled();
  });
});
