// ============================================================
//  All-Downloader — Shared Constants (TypeScript)
//  Single source of truth for all enums, keys, config defaults
// ============================================================
import type { DownloadState, FileCategory } from './types.js';

// ── Download States ──────────────────────────────────────────
export const DOWNLOAD_STATE: Record<string, DownloadState> = Object.freeze({
  QUEUED:      'queued',
  CONNECTING:  'connecting',
  DOWNLOADING: 'downloading',
  PAUSED:      'paused',
  MERGING:     'merging',
  VERIFYING:   'verifying',
  COMPLETED:   'completed',
  ERROR:        'error',
  CANCELLED:   'cancelled',
});

// ── File Categories ───────────────────────────────────────────
export const FILE_CATEGORY: Record<string, FileCategory> = Object.freeze({
  VIDEO:       'video',
  AUDIO:       'audio',
  IMAGE:       'image',
  DOCUMENT:    'document',
  ARCHIVE:     'archive',
  APPLICATION: 'application',
  OTHER:       'other',
});

// ── Category MIME / extension mapping ────────────────────────
export const CATEGORY_MAP: Record<string, readonly string[]> = Object.freeze({
  video:       ['mp4','mkv','avi','mov','wmv','flv','webm','m4v','mpg','mpeg','ts','m2ts','vob','3gp','ogv','rmvb','m4s'],
  audio:       ['mp3','aac','flac','wav','ogg','m4a','wma','opus','alac','aiff','mka','mid','midi'],
  image:       ['jpg','jpeg','png','gif','webp','svg','bmp','ico','tiff','avif','heic','heif','jxl','psd','ai','raw','dng','cr2','cr3','arw','nef','eps'],
  document:    ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','csv','json','xml','md','rtf','epub','mobi','odt','ods','odp','parquet','arrow','ipynb','djvu','cbr','cbz','yaml','yml','toml','tex','log'],
  archive:     ['zip','rar','7z','tar','gz','bz2','xz','iso','tgz','tbz2','zst','lzma','cab','dmg','wim','cpio'],
  application: ['exe','msi','dmg','apk','deb','rpm','pkg','run','appimage','wasm','crx','whl'],
});

// ── Message Types (Service Worker ↔ UI) ──────────────────────
export const MSG = Object.freeze({
  // SW → UI
  DOWNLOAD_ADDED:      'DOWNLOAD_ADDED',
  DOWNLOAD_PROGRESS:   'DOWNLOAD_PROGRESS',
  DOWNLOAD_COMPLETED:  'DOWNLOAD_COMPLETED',
  DOWNLOAD_ERROR:      'DOWNLOAD_ERROR',
  DOWNLOAD_PAUSED:     'DOWNLOAD_PAUSED',
  DOWNLOAD_RESUMED:    'DOWNLOAD_RESUMED',
  DOWNLOAD_CANCELLED:  'DOWNLOAD_CANCELLED',
  DOWNLOAD_DELETED:    'DOWNLOAD_DELETED',

  // UI → SW
  GET_DOWNLOADS:       'GET_DOWNLOADS',
  PAUSE_DOWNLOAD:      'PAUSE_DOWNLOAD',
  RESUME_DOWNLOAD:     'RESUME_DOWNLOAD',
  CANCEL_DOWNLOAD:     'CANCEL_DOWNLOAD',
  RETRY_DOWNLOAD:      'RETRY_DOWNLOAD',
  START_DOWNLOAD:      'START_DOWNLOAD',
  DELETE_DOWNLOAD:     'DELETE_DOWNLOAD',
  UPDATE_SETTINGS:     'UPDATE_SETTINGS',
  GET_SETTINGS:        'GET_SETTINGS',
  CLEAR_HISTORY:       'CLEAR_HISTORY',
  OPEN_DASHBOARD:      'OPEN_DASHBOARD',
  PRIORITIZE_DOWNLOAD: 'PRIORITIZE_DOWNLOAD',
  MOVE_QUEUE_ITEM:     'MOVE_QUEUE_ITEM',
  START_QUEUED_NOW:    'START_QUEUED_NOW',
  CLEAR_QUEUE:         'CLEAR_QUEUE',
  SHOW_IN_FOLDER:      'SHOW_IN_FOLDER',

  // Offscreen document messaging (Zero-copy Blob URL generation)
  OFFSCREEN_CREATE_BLOB_URL: 'OFFSCREEN_CREATE_BLOB_URL',
  OFFSCREEN_REVOKE_BLOB_URL: 'OFFSCREEN_REVOKE_BLOB_URL',

  // Context Menu & User Intent Detection
  USER_RIGHT_CLICKED:          'USER_RIGHT_CLICKED',
  USER_DISMISSED_CONTEXT_MENU: 'USER_DISMISSED_CONTEXT_MENU',
} as const);

// ── Category Folder Names ─────────────────────────────────────
export const CATEGORY_FOLDER_NAMES: Record<FileCategory, string> = Object.freeze({
  video:       'Videos',
  audio:       'Audio',
  image:       'Images',
  document:    'Documents',
  archive:     'Archives',
  application: 'Applications',
  other:       'Other',
});

// ── Heavy / High-Bandwidth Extensions (Always Intercept) ──────
export const HEAVY_EXTENSIONS = new Set<string>([
  // Disk Images & Virtual Machines
  'iso', 'img', 'bin', 'vhd', 'vhdx', 'vmdk', 'qcow2', 'dmg',
  // Compressed & Multi-part Archives
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tbz2', 'zst', 'lzma', 'cab', 'wim', 'cpio',
  // Installers & Executables & Packages
  'exe', 'msi', 'apk', 'pkg', 'deb', 'rpm', 'appimage', 'run',
  // High-bitrate Video & Media
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', 'm2ts', 'vob',
]);

// ── Storage Keys ─────────────────────────────────────────────
export const STORAGE_KEY = Object.freeze({
  DOWNLOADS: 'all_downloader_downloads',
  SETTINGS:  'all_downloader_settings',
  STATS:     'all_downloader_stats',
} as const);

// ── Default Settings ──────────────────────────────────────────
export const DEFAULT_SETTINGS = Object.freeze({
  maxConcurrent:             3,     // max simultaneous downloads
  maxChunks:                 8,     // segments per file
  minChunkSizeMB:            2,     // min file size to chunk (MB)
  speedLimitKBps:            0,     // 0 = unlimited
  defaultSavePath:           '',    // empty = browser default
  autoStart:                 true,  // auto-start queued downloads
  showNotifications:         true,  // OS notifications on complete
  verifyIntegrity:           true,  // SHA-256 check when server provides hash
  interceptDownloads:        true,  // intercept browser downloads dynamically for all file types and sizes
  preserveChunksOnCancel:    true,  // keep 100% downloaded chunks if user closes/cancels Save As dialog
  organizeByCategoryFolders: false, // subfolder per category (Videos, Archives, etc.)
  darkMode:                  true,
  maxHistoryItems:           500,
});

// ── UI Config ─────────────────────────────────────────────────
export const UI = Object.freeze({
  POPUP_MAX_VISIBLE:   7,    // max download items in popup
  PROGRESS_INTERVAL:   500,  // ms between progress broadcasts
  SPEED_SAMPLE_WINDOW: 3000, // ms window for speed average
} as const);

