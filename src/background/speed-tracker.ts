// ============================================================
//  All-Downloader — Speed Tracker (TypeScript)
//  Rolling-window average speed calculator with ETA support.
// ============================================================
import { UI } from '../shared/constants.js';

interface SpeedSample {
  time: number;
  bytes: number;
}

export interface SpeedSnapshot {
  bytesPerSec: number;
  etaSec: number | null;
}

/**
 * SpeedTracker — one instance per active download.
 * Uses a sliding time-window to smooth out speed spikes.
 */
export class SpeedTracker {
  private windowMs: number;
  private samples: SpeedSample[];
  private bytesPerSec: number;
  private etaSec: number;

  constructor(windowMs: number = UI.SPEED_SAMPLE_WINDOW) {
    this.windowMs = windowMs;
    this.samples = [];
    this.bytesPerSec = 0;
    this.etaSec = Infinity;
  }

  /**
   * Record a new byte count (absolute, not delta).
   * Call this on every progress event.
   */
  record(totalReceived: number, totalSize: number): void {
    const now = Date.now();
    this.samples.push({ time: now, bytes: totalReceived });

    // Prune samples outside the window
    const cutoff = now - this.windowMs;
    while (this.samples.length > 1 && (this.samples[0]?.time ?? 0) < cutoff) {
      this.samples.shift();
    }

    // Need at least 2 samples to measure speed
    if (this.samples.length < 2) {
      this.bytesPerSec = 0;
      this.etaSec = Infinity;
      return;
    }

    const oldest = this.samples[0]!;
    const newest = this.samples[this.samples.length - 1]!;
    const bytesDelta = newest.bytes - oldest.bytes;
    const timeDelta = (newest.time - oldest.time) / 1000; // seconds

    this.bytesPerSec = timeDelta > 0 ? bytesDelta / timeDelta : 0;

    if (totalSize > 0 && this.bytesPerSec > 0) {
      const remaining = totalSize - totalReceived;
      this.etaSec = remaining / this.bytesPerSec;
    } else {
      this.etaSec = Infinity;
    }
  }

  /** Reset (called on resume to avoid stale samples). */
  reset(): void {
    this.samples = [];
    this.bytesPerSec = 0;
    this.etaSec = Infinity;
  }

  /** Get current snapshot. */
  getSnapshot(): SpeedSnapshot {
    return {
      bytesPerSec: Math.round(this.bytesPerSec),
      etaSec: isFinite(this.etaSec) ? Math.ceil(this.etaSec) : null,
    };
  }
}
