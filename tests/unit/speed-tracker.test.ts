// ============================================================
//  Unit Tests — SpeedTracker
// ============================================================
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { SpeedTracker } from '../../src/background/speed-tracker.ts';

describe('SpeedTracker Core', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  test('single sample is marked as calibrating with null eta', () => {
    const tracker = new SpeedTracker();
    const total = 100 * 1024 * 1024; // 100 MB

    tracker.record(5 * 1024 * 1024, total);
    const snap = tracker.getSnapshot();

    expect(snap.bytesPerSec).toBe(0);
    expect(snap.etaSec).toBeNull();
    expect(snap.isCalibrating).toBe(true);
  });

  test('multiple samples calculate positive speed and reasonable ETA', () => {
    vi.useFakeTimers();
    const tracker = new SpeedTracker();
    const total = 100 * 1024 * 1024; // 100 MB

    tracker.record(0, total);

    // Advance 500ms and record 5 MB (rate = 10 MB/s)
    vi.advanceTimersByTime(500);
    tracker.record(5 * 1024 * 1024, total);

    const snap1 = tracker.getSnapshot();
    expect(snap1.bytesPerSec).toBeGreaterThan(0);
    expect(typeof snap1.etaSec).toBe('number');
    // Remaining is 95 MB, at ~10 MB/s, ETA should be around 9-10s
    expect(snap1.etaSec!).toBeGreaterThanOrEqual(7);
    expect(snap1.etaSec!).toBeLessThanOrEqual(12);

    // Advance another 500ms and record another 5 MB (rate continues at 10 MB/s)
    vi.advanceTimersByTime(500);
    tracker.record(10 * 1024 * 1024, total);

    const snap2 = tracker.getSnapshot();
    expect(snap2.bytesPerSec).toBeGreaterThan(0);
    // ETA should have smoothly decreased
    expect(snap2.etaSec!).toBeLessThanOrEqual(snap1.etaSec!);
  });

  test('smooths out spikes using EWMA countdown drift', () => {
    vi.useFakeTimers();
    const tracker = new SpeedTracker();
    const total = 100 * 1024 * 1024; // 100 MB

    tracker.record(0, total);
    vi.advanceTimersByTime(500);
    tracker.record(5 * 1024 * 1024, total);

    const prevETA = tracker.getSnapshot().etaSec!;

    // A sudden burst in one tick (10 MB in 500ms = 20 MB/s)
    vi.advanceTimersByTime(500);
    tracker.record(15 * 1024 * 1024, total);

    const newETA = tracker.getSnapshot().etaSec!;
    // Thanks to EWMA and countdown drift, ETA should adjust gently without instantly halving
    expect(newETA).toBeLessThan(prevETA);
    expect(newETA).toBeGreaterThan(prevETA * 0.5);
  });

  test('reports eta 0 when download completes', () => {
    vi.useFakeTimers();
    const tracker = new SpeedTracker();
    const total = 50 * 1024 * 1024;

    tracker.record(0, total);
    vi.advanceTimersByTime(500);
    tracker.record(25 * 1024 * 1024, total);

    vi.advanceTimersByTime(500);
    tracker.record(total, total);

    const snap = tracker.getSnapshot();
    expect(snap.etaSec).toBe(0);
  });

  test('handles network stalls gracefully: soft decay then invalidation', () => {
    vi.useFakeTimers();
    const tracker = new SpeedTracker();
    const total = 100 * 1024 * 1024;

    tracker.record(0, total);
    vi.advanceTimersByTime(500);
    tracker.record(10 * 1024 * 1024, total);

    const activeSnap = tracker.getSnapshot();
    expect(activeSnap.bytesPerSec).toBeGreaterThan(0);

    // Stalled for 2 seconds (no new bytes)
    vi.advanceTimersByTime(2000);
    tracker.record(10 * 1024 * 1024, total);

    const pauseSnap = tracker.getSnapshot();
    // Speed softly decayed, not immediately dropped to 0
    expect(pauseSnap.bytesPerSec).toBeGreaterThan(0);
    expect(pauseSnap.bytesPerSec).toBeLessThan(activeSnap.bytesPerSec);

    // Stalled for > 5.5 seconds total
    vi.advanceTimersByTime(4000);
    tracker.record(10 * 1024 * 1024, total);

    const stallSnap = tracker.getSnapshot();
    expect(stallSnap.bytesPerSec).toBe(0);
    expect(stallSnap.etaSec).toBeNull();
  });

  test('reset clears all stats and history', () => {
    vi.useFakeTimers();
    const tracker = new SpeedTracker();
    const total = 100 * 1024 * 1024;

    tracker.record(0, total);
    vi.advanceTimersByTime(1000);
    tracker.record(20 * 1024 * 1024, total);

    expect(tracker.getSnapshot().bytesPerSec).toBeGreaterThan(0);

    tracker.reset();
    const resetSnap = tracker.getSnapshot();
    expect(resetSnap.bytesPerSec).toBe(0);
    expect(resetSnap.etaSec).toBeNull();
    expect(resetSnap.isCalibrating).toBe(true);
  });
});
