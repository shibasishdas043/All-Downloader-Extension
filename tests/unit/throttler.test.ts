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
});
