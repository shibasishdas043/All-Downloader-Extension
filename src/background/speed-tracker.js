// ============================================================
//  All-Downloader — Speed Tracker
//  Rolling-window average speed calculator with ETA support.
// ============================================================
import { UI } from '../shared/constants.js';

/**
 * SpeedTracker — one instance per active download.
 * Uses a sliding time-window to smooth out speed spikes.
 */
export class SpeedTracker {
  /**
   * @param {number} windowMs  Averaging window in ms (default from constants)
   */
  constructor(windowMs = UI.SPEED_SAMPLE_WINDOW) {
    this.windowMs = windowMs;
    /** @type {Array<{time: number, bytes: number}>} */
    this.samples  = [];
    this.bytesPerSec = 0;
    this.etaSec      = Infinity;
  }

  /**
   * Record a new byte count (absolute, not delta).
   * Call this on every progress event.
   * @param {number} totalReceived  Total bytes received so far
   * @param {number} totalSize      Full file size in bytes (0 if unknown)
   */
  record(totalReceived, totalSize) {
    const now = Date.now();
    this.samples.push({ time: now, bytes: totalReceived });

    // Prune samples outside the window
    const cutoff = now - this.windowMs;
    while (this.samples.length > 1 && this.samples[0].time < cutoff) {
      this.samples.shift();
    }

    // Need at least 2 samples to measure speed
    if (this.samples.length < 2) {
      this.bytesPerSec = 0;
      this.etaSec      = Infinity;
      return;
    }

    const oldest   = this.samples[0];
    const newest   = this.samples[this.samples.length - 1];
    const bytesDelta = newest.bytes - oldest.bytes;
    const timeDelta  = (newest.time - oldest.time) / 1000; // seconds

    this.bytesPerSec = timeDelta > 0 ? bytesDelta / timeDelta : 0;

    if (totalSize > 0 && this.bytesPerSec > 0) {
      const remaining = totalSize - totalReceived;
      this.etaSec = remaining / this.bytesPerSec;
    } else {
      this.etaSec = Infinity;
    }
  }

  /** Reset (called on resume to avoid stale samples). */
  reset() {
    this.samples     = [];
    this.bytesPerSec = 0;
    this.etaSec      = Infinity;
  }

  /** Get current snapshot. */
  getSnapshot() {
    return {
      bytesPerSec: Math.round(this.bytesPerSec),
      etaSec:      isFinite(this.etaSec) ? Math.ceil(this.etaSec) : null,
    };
  }
}
