// ============================================================
//  All-Downloader — Download Engine Rate Limiter / Throttler
// ============================================================

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

/**
 * Concurrency-Safe Rate Limiter using Virtual Timeline Scheduling (Leaky-Bucket / Virtual Clock).
 * Accurately caps throughput across multiple parallel chunk streams and concurrent downloads.
 */
export class RateLimiter {
  private bytesPerSec: number = 0;
  private nextAvailableTime: number = 0;
  private maxBurstMs: number;

  constructor(kbps: number = 0, maxBurstMs: number = 100) {
    const validKbps = Math.max(0, Number(kbps) || 0);
    this.bytesPerSec = validKbps * 1024;
    this.maxBurstMs = Math.max(0, Number(maxBurstMs) || 100);
    this.nextAvailableTime = Date.now();
  }

  setRate(kbps: number): void {
    const validKbps = Math.max(0, Number(kbps) || 0);
    const oldRate = this.bytesPerSec;
    this.bytesPerSec = validKbps * 1024;
    const now = Date.now();

    if (this.bytesPerSec <= 0) {
      this.nextAvailableTime = now;
    } else if (oldRate <= 0) {
      this.nextAvailableTime = now;
    } else if (this.nextAvailableTime > now) {
      const remainingMs = this.nextAvailableTime - now;
      const remainingBytes = (remainingMs / 1000) * oldRate;
      this.nextAvailableTime = now + (remainingBytes / this.bytesPerSec) * 1000;
    } else {
      this.nextAvailableTime = now;
    }
  }

  getRateKBps(): number {
    return this.bytesPerSec / 1024;
  }

  async acquire(bytes: number, signal?: AbortSignal): Promise<void> {
    if (this.bytesPerSec <= 0 || bytes <= 0) {
      return;
    }

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const now = Date.now();
    // Allow a small bounded burst window if idle
    if (this.nextAvailableTime < now - this.maxBurstMs) {
      this.nextAvailableTime = now - this.maxBurstMs;
    }

    const scheduledTime = Math.max(now, this.nextAvailableTime);
    const durationMs = (bytes / this.bytesPerSec) * 1000;
    this.nextAvailableTime = scheduledTime + durationMs;

    const waitMs = scheduledTime - now;
    if (waitMs <= 0) {
      return;
    }

    try {
      await sleep(waitMs, signal);
    } catch (err) {
      const abortNow = Date.now();
      if (this.nextAvailableTime > abortNow) {
        this.nextAvailableTime = Math.max(abortNow, this.nextAvailableTime - durationMs);
      }
      throw err;
    }
  }
}

export type ThrottleFn = ((bytes: number, signal?: AbortSignal) => Promise<void>) & {
  limiter: RateLimiter;
  setRate: (kbps: number) => void;
};

/**
 * Creates a concurrency-safe rate limiter function.
 */
export function createThrottle(kbps: number): ThrottleFn {
  const limiter = new RateLimiter(kbps);
  const fn = ((bytes: number, signal?: AbortSignal) => limiter.acquire(bytes, signal)) as ThrottleFn;
  fn.limiter = limiter;
  fn.setRate = (newKbps: number) => limiter.setRate(newKbps);
  return fn;
}
