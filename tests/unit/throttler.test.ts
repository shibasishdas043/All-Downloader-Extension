// ============================================================
//  Unit Tests — throttler.ts
// ============================================================
import { describe, test, expect } from 'vitest';
import { createThrottle } from '../../src/background/download-engine/throttler.js';

describe('createThrottle', () => {
  test('returns no-op function when kbps <= 0', async () => {
    const throttleZero = createThrottle(0);
    const throttleNeg = createThrottle(-10);

    const start = Date.now();
    await throttleZero(1024 * 1024);
    await throttleNeg(1024 * 1024);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  test('permits immediate consumption within initial token burst', async () => {
    // 100 KB/s rate limit -> initial tokens = 100 KB
    const throttle = createThrottle(100);
    const start = Date.now();
    await throttle(50 * 1024); // 50 KB, less than initial bucket
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  test('serializes concurrent parallel chunks to strictly respect speed limit', async () => {
    // 200 KB/s rate limit
    const throttle = createThrottle(200);
    const chunkBytes = 40 * 1024; // 40 KB

    const start = Date.now();
    // 3 parallel chunks downloading simultaneously = 120 KB total
    // At 200 KB/s, 120 KB requires at least ~500ms (1st immediate, 2nd +200ms, 3rd +200ms -> finishes at ~400ms)
    await Promise.all([
      throttle(chunkBytes),
      throttle(chunkBytes),
      throttle(chunkBytes),
    ]);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(350);
  });

  test('dynamically updates rate limit when setRate is called', async () => {
    const throttle = createThrottle(500);
    expect(throttle.limiter.getRateKBps()).toBe(500);

    throttle.setRate(250);
    expect(throttle.limiter.getRateKBps()).toBe(250);

    throttle.setRate(0);
    expect(throttle.limiter.getRateKBps()).toBe(0);
  });
});
