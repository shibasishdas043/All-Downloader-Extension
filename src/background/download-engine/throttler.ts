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
 * Token-Bucket Rate Limiter
 */
export function createThrottle(kbps: number): (bytes: number) => Promise<void> {
  if (!kbps || kbps <= 0) {
    return () => Promise.resolve();
  }

  const bytesPerSec = kbps * 1024;
  let tokens = bytesPerSec;
  let lastRefill = Date.now();
  const MAX_TOKENS = bytesPerSec * 2;

  return function throttle(bytes: number): Promise<void> {
    const now = Date.now();
    const elapsed = (now - lastRefill) / 1000;
    tokens = Math.min(MAX_TOKENS, tokens + elapsed * bytesPerSec);
    lastRefill = now;

    if (tokens >= bytes) {
      tokens -= bytes;
      return Promise.resolve();
    }

    const deficit = bytes - tokens;
    const waitMs = (deficit / bytesPerSec) * 1000;
    tokens = 0;
    return sleep(waitMs);
  };
}
