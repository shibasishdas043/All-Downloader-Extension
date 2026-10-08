// ============================================================
//  All-Downloader — Speed Tracker (TypeScript)
//  Rolling-window + EWMA smoothed speed & stable ETA estimator.
// ============================================================
import { UI } from '../shared/constants.js';

interface SpeedSample {
  time: number;
  bytes: number;
}

export interface SpeedSnapshot {
  bytesPerSec: number;
  etaSec: number | null;
  isCalibrating: boolean;
}

/**
 * SpeedTracker — one instance per active download.
 * Employs a hybrid sliding window with Exponential Weighted Moving Average (EWMA)
 * and natural countdown drift to eliminate jitter, wild ETA spikes, and stalling flicker.
 */
export class SpeedTracker {
  private windowMs: number;
  private samples: SpeedSample[];
  private smoothedSpeed: number;
  private smoothedETA: number;
  private startTime: number;
  private lastProgressTime: number;
  private lastUpdateTime: number;
  private lastReceivedBytes: number;

  constructor(windowMs: number = UI.SPEED_SAMPLE_WINDOW) {
    this.windowMs = windowMs;
    this.samples = [];
    this.smoothedSpeed = 0;
    this.smoothedETA = Infinity;
    this.startTime = 0;
    this.lastProgressTime = 0;
    this.lastUpdateTime = 0;
    this.lastReceivedBytes = 0;
  }

  /**
   * Record a new byte count (absolute, not delta).
   * Call this on every progress event.
   */
  record(totalReceived: number, totalSize: number): void {
    const now = Date.now();
    if (!this.startTime) {
      this.startTime = now;
      this.lastProgressTime = now;
      this.lastUpdateTime = now;
      this.lastReceivedBytes = totalReceived;
    }

    if (totalReceived > this.lastReceivedBytes) {
      this.lastProgressTime = now;
      this.lastReceivedBytes = totalReceived;
    }

    this.samples.push({ time: now, bytes: totalReceived });

    // Prune samples outside the window
    const cutoff = now - this.windowMs;
    while (this.samples.length > 1 && (this.samples[0]?.time ?? 0) < cutoff) {
      this.samples.shift();
    }

    // Need at least 2 samples to measure speed
    if (this.samples.length < 2) {
      this.smoothedSpeed = 0;
      this.smoothedETA = Infinity;
      return;
    }

    const oldest = this.samples[0]!;
    const newest = this.samples[this.samples.length - 1]!;
    const bytesDelta = Math.max(0, newest.bytes - oldest.bytes);
    const timeDelta = (newest.time - oldest.time) / 1000; // seconds

    const rawSpeed = timeDelta > 0.05 ? bytesDelta / timeDelta : 0;

    // Check for stalls (no bytes received recently)
    const timeSinceProgress = now - this.lastProgressTime;
    if (timeSinceProgress > 5000) {
      // Sustained stall: drop speed to 0 and invalidate ETA
      this.smoothedSpeed = 0;
      this.smoothedETA = Infinity;
      this.lastUpdateTime = now;
      return;
    }

    // EWMA for speed: blend raw instantaneous rate with smoothed rate
    if (this.smoothedSpeed <= 0) {
      this.smoothedSpeed = rawSpeed;
    } else if (rawSpeed === 0 && timeSinceProgress > 1500) {
      // Soft decay during temporary network stall
      this.smoothedSpeed *= 0.85;
    } else if (rawSpeed > 0) {
      // Adaptive alpha: slightly higher if rawSpeed is close, smooth out outliers
      const alpha = 0.28;
      this.smoothedSpeed = alpha * rawSpeed + (1 - alpha) * this.smoothedSpeed;
    }

    // Calculate time elapsed since last calculation for natural countdown drift
    const dt = this.lastUpdateTime > 0 ? Math.max(0, (now - this.lastUpdateTime) / 1000) : 0;
    this.lastUpdateTime = now;

    // ETA calculation
    if (totalSize > 0 && totalReceived >= totalSize) {
      this.smoothedETA = 0;
    } else if (totalSize > 0 && this.smoothedSpeed > 10) {
      const remainingBytes = Math.max(0, totalSize - totalReceived);
      const rawETA = remainingBytes / this.smoothedSpeed;

      if (!isFinite(this.smoothedETA) || this.smoothedETA <= 0) {
        this.smoothedETA = rawETA;
      } else {
        // Natural countdown drift: remaining time ticks down by dt
        const naturalETA = Math.max(0, this.smoothedETA - dt);
        // EWMA blend natural countdown with newly computed raw ETA
        // 18% weight to new sample, 82% to smooth countdown drift
        const etaAlpha = 0.18;
        this.smoothedETA = etaAlpha * rawETA + (1 - etaAlpha) * naturalETA;
      }
    } else {
      if (timeSinceProgress > 3000) {
        this.smoothedETA = Infinity;
      }
    }
  }

  /** Reset (called on resume to avoid stale samples). */
  reset(): void {
    this.samples = [];
    this.smoothedSpeed = 0;
    this.smoothedETA = Infinity;
    this.startTime = 0;
    this.lastProgressTime = 0;
    this.lastUpdateTime = 0;
    this.lastReceivedBytes = 0;
  }

  /**
   * Check if speed & ETA are still calibrating in the initial startup window.
   */
  isCalibrating(): boolean {
    if (!this.startTime) return true;
    const elapsed = Date.now() - this.startTime;
    return elapsed < 1200 || this.samples.length < 3;
  }

  /** Get current snapshot. */
  getSnapshot(): SpeedSnapshot {
    const calibrating = this.isCalibrating();
    const hasValidETA = Number.isFinite(this.smoothedETA) && this.smoothedETA >= 0;
    const bytesPerSec = Number.isFinite(this.smoothedSpeed) ? Math.max(0, Math.round(this.smoothedSpeed)) : 0;

    return {
      bytesPerSec,
      etaSec: hasValidETA ? Math.ceil(this.smoothedETA) : null,
      isCalibrating: calibrating,
    };
  }
}

