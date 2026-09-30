// ============================================================
//  All-Downloader — File Category Detection
// ============================================================
import { CATEGORY_MAP, FILE_CATEGORY } from '../constants.js';
import type { FileCategory } from '../types.js';
import { getExtension } from './filename.js';

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
