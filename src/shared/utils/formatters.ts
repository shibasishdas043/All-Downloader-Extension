// ============================================================
//  All-Downloader — Byte, Speed & Time Formatters
// ============================================================

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatBytes(bytes: number | null | undefined, decimals = 2): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeI = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, safeI)).toFixed(dm))} ${sizes[safeI]}`;
}

export function formatSpeed(bytesPerSec: number | null | undefined): string {
  if (!bytesPerSec || bytesPerSec <= 0 || isNaN(bytesPerSec)) return '0 B/s';
  return `${formatBytes(bytesPerSec, 1)}/s`;
}

/**
 * Format ETA in classic digital clock format (e.g. "01:30", "01:01:01", "--:--").
 * Fully backward-compatible with existing unit tests.
 */
export function formatETA(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/**
 * Format ETA in a friendly, unambiguous human-readable format.
 * Examples:
 *   - 0 / null / inf -> "—"
 *   - 45             -> "45s"
 *   - 90             -> "1m 30s"
 *   - 3661           -> "1h 1m"
 *   - 90000          -> "1d 1h"
 */
export function formatHumanETA(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds) || seconds <= 0) return '—';
  const sec = Math.ceil(seconds);
  if (sec < 60) {
    return `${sec}s`;
  }
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

