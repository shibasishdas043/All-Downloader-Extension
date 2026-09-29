// ============================================================
//  All-Downloader — Shared Utilities
// ============================================================
import { CATEGORY_MAP, FILE_CATEGORY } from './constants.js';

// ── Byte / Size Formatting ────────────────────────────────────
/**
 * Format raw bytes into human-readable string.
 * @param {number} bytes
 * @param {number} decimals
 * @returns {string}
 */
export function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// ── Speed Formatting ─────────────────────────────────────────
/**
 * Format bytes/sec into human-readable speed string.
 * @param {number} bytesPerSec
 * @returns {string}
 */
export function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec, 1)}/s`;
}

// ── Time / ETA Formatting ─────────────────────────────────────
/**
 * Format seconds into MM:SS or HH:MM:SS string.
 * @param {number} seconds
 * @returns {string}
 */
export function formatETA(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// ── Filename Utilities ────────────────────────────────────────
/**
 * Extract filename from URL (fallback: 'download').
 * @param {string} url
 * @returns {string}
 */
export function getFilenameFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    const last = parts[parts.length - 1];
    return decodeURIComponent(last) || 'download';
  } catch {
    return 'download';
  }
}

/**
 * Extract extension (without dot) from filename.
 * @param {string} filename
 * @returns {string}
 */
export function getExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Truncate filename for display.
 * @param {string} name
 * @param {number} max
 * @returns {string}
 */
export function truncateName(name, max = 32) {
  if (name.length <= max) return name;
  const ext = getExtension(name);
  const base = name.slice(0, name.length - ext.length - 1);
  const truncated = base.slice(0, max - ext.length - 4);
  return `${truncated}...${ext ? '.' + ext : ''}`;
}

// ── Category Detection ────────────────────────────────────────
/**
 * Detect file category from filename extension.
 * @param {string} filename
 * @returns {string}
 */
export function detectCategory(filename) {
  const ext = getExtension(filename);
  for (const [cat, exts] of Object.entries(CATEGORY_MAP)) {
    if (exts.includes(ext)) return cat;
  }
  return FILE_CATEGORY.OTHER;
}

// ── Unique ID Generator ───────────────────────────────────────
/**
 * Generate a unique download ID.
 * @returns {string}
 */
export function generateId() {
  return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ── Percentage ────────────────────────────────────────────────
/**
 * Calculate percentage (0–100), safe for zero total.
 * @param {number} received
 * @param {number} total
 * @returns {number}
 */
export function calcPercent(received, total) {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((received / total) * 100));
}

// ── URL Validation ────────────────────────────────────────────
/**
 * Check if a string is a valid HTTP(S) URL.
 * @param {string} url
 * @returns {boolean}
 */
export function isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Timestamp ─────────────────────────────────────────────────
/**
 * Human-readable relative time (e.g. "2 min ago").
 * @param {number} timestamp  Unix ms
 * @returns {string}
 */
export function relativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 60_000)      return 'Just now';
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)} hr ago`;
  return new Date(timestamp).toLocaleDateString();
}

// ── Content-Disposition parser ────────────────────────────────
/**
 * Extract filename from Content-Disposition header.
 * @param {string} header
 * @returns {string|null}
 */
export function parseContentDisposition(header) {
  if (!header) return null;
  const match = header.match(/filename\*?=["']?(?:UTF-8'')?([^;"'\n]+)/i);
  return match ? decodeURIComponent(match[1].trim()) : null;
}

// ── Sleep helper ──────────────────────────────────────────────
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
