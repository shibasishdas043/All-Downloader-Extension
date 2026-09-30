// ============================================================
//  All-Downloader — Shared Utilities (TypeScript)
// ============================================================
import { CATEGORY_MAP, FILE_CATEGORY } from './constants.js';
import type { FileCategory } from './types.js';

// ── Byte / Size Formatting ────────────────────────────────────
export function formatBytes(bytes: number | null | undefined, decimals = 2): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeI = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, safeI)).toFixed(dm))} ${sizes[safeI]}`;
}

// ── Speed Formatting ─────────────────────────────────────────
export function formatSpeed(bytesPerSec: number | null | undefined): string {
  if (!bytesPerSec || bytesPerSec <= 0 || isNaN(bytesPerSec)) return '0 B/s';
  return `${formatBytes(bytesPerSec, 1)}/s`;
}

// ── Time / ETA Formatting ─────────────────────────────────────
export function formatETA(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// ── Filename Utilities ────────────────────────────────────────
export function getFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    const last = parts[parts.length - 1];
    return decodeURIComponent(last) || 'download';
  } catch {
    return 'download';
  }
}

export function getExtension(filename: string): string {
  if (!filename) return '';
  const parts = filename.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] || '').toLowerCase() : '';
}

export function truncateName(name: string, max = 32): string {
  if (!name || name.length <= max) return name;
  const ext = getExtension(name);
  const base = name.slice(0, name.length - ext.length - (ext ? 1 : 0));
  const truncated = base.slice(0, Math.max(0, max - ext.length - 4));
  return `${truncated}...${ext ? '.' + ext : ''}`;
}

// ── Category Detection ────────────────────────────────────────
export function detectCategoryFromMime(mimeType?: string | null): FileCategory {
  if (!mimeType) return FILE_CATEGORY.OTHER as FileCategory;

  const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
  if (!cleanMime || cleanMime === 'application/octet-stream') {
    return FILE_CATEGORY.OTHER as FileCategory;
  }

  // 1. Direct standard media prefixes
  if (cleanMime.startsWith('video/')) return FILE_CATEGORY.VIDEO as FileCategory;
  if (cleanMime.startsWith('audio/')) return FILE_CATEGORY.AUDIO as FileCategory;
  if (cleanMime.startsWith('image/')) return FILE_CATEGORY.IMAGE as FileCategory;
  if (cleanMime.startsWith('text/')) return FILE_CATEGORY.DOCUMENT as FileCategory;

  // 2. Video / Streaming container types
  if (
    cleanMime === 'application/x-matroska' ||
    cleanMime === 'application/vnd.apple.mpegurl' ||
    cleanMime === 'application/dash+xml' ||
    cleanMime === 'application/ogg' ||
    cleanMime === 'application/x-mpegurl'
  ) {
    return FILE_CATEGORY.VIDEO as FileCategory;
  }

  // 3. Documents (PDF, Office, eBook, Data, Markup)
  if (
    cleanMime === 'application/pdf' ||
    cleanMime === 'application/msword' ||
    cleanMime === 'application/rtf' ||
    cleanMime === 'application/epub+zip' ||
    cleanMime === 'application/json' ||
    cleanMime === 'application/xml' ||
    cleanMime === 'application/xhtml+xml' ||
    cleanMime.includes('officedocument') ||
    cleanMime.includes('opendocument') ||
    cleanMime.includes('ms-excel') ||
    cleanMime.includes('ms-powerpoint') ||
    cleanMime.includes('wordprocessingml') ||
    cleanMime.includes('spreadsheetml') ||
    cleanMime.includes('presentationml')
  ) {
    return FILE_CATEGORY.DOCUMENT as FileCategory;
  }

  // 4. Archives & Compressed Packages
  if (
    cleanMime === 'application/zip' ||
    cleanMime === 'application/x-zip-compressed' ||
    cleanMime === 'application/x-7z-compressed' ||
    cleanMime === 'application/x-rar-compressed' ||
    cleanMime === 'application/vnd.rar' ||
    cleanMime === 'application/x-tar' ||
    cleanMime === 'application/gzip' ||
    cleanMime === 'application/x-gzip' ||
    cleanMime === 'application/x-bzip' ||
    cleanMime === 'application/x-bzip2' ||
    cleanMime === 'application/x-xz' ||
    cleanMime === 'application/x-iso9660-image' ||
    cleanMime === 'application/zstd' ||
    cleanMime === 'application/x-lzma'
  ) {
    return FILE_CATEGORY.ARCHIVE as FileCategory;
  }

  // 5. Executables & Program Installers
  if (
    cleanMime === 'application/x-msdownload' ||
    cleanMime === 'application/x-msi' ||
    cleanMime === 'application/vnd.android.package-archive' ||
    cleanMime === 'application/x-apple-diskimage' ||
    cleanMime === 'application/x-debian-package' ||
    cleanMime === 'application/x-redhat-package-manager' ||
    cleanMime === 'application/x-executable'
  ) {
    return FILE_CATEGORY.APPLICATION as FileCategory;
  }

  return FILE_CATEGORY.OTHER as FileCategory;
}

export function detectCategory(filename: string, mimeType?: string | null): FileCategory {
  // 1. Check extension from filename first if available
  const ext = getExtension(filename);
  if (ext) {
    for (const [cat, exts] of Object.entries(CATEGORY_MAP)) {
      if ((exts as readonly string[]).includes(ext)) {
        return cat as FileCategory;
      }
    }
  }

  // 2. Fallback to MIME-type detection if extension is unknown or missing
  if (mimeType) {
    const mimeCat = detectCategoryFromMime(mimeType);
    if (mimeCat !== FILE_CATEGORY.OTHER) {
      return mimeCat;
    }
  }

  return FILE_CATEGORY.OTHER as FileCategory;
}

// ── Unique ID Generator ───────────────────────────────────────
export function generateId(): string {
  return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ── Percentage ────────────────────────────────────────────────
export function calcPercent(received: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((received / total) * 100));
}

// ── URL Validation ────────────────────────────────────────────
export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Timestamp ─────────────────────────────────────────────────
export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000)      return 'Just now';
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)} hr ago`;
  return new Date(timestamp).toLocaleDateString();
}
