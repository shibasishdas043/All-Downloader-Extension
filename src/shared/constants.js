// ============================================================
//  All-Downloader — Shared Constants
//  Single source of truth for all enums, keys, config defaults
// ============================================================

// ── Download States ──────────────────────────────────────────
export const DOWNLOAD_STATE = Object.freeze({
  QUEUED:     'queued',
  CONNECTING: 'connecting',
  DOWNLOADING:'downloading',
  PAUSED:     'paused',
  MERGING:    'merging',
  VERIFYING:  'verifying',
  COMPLETED:  'completed',
  ERROR:      'error',
  CANCELLED:  'cancelled',
});

// ── File Categories ───────────────────────────────────────────
export const FILE_CATEGORY = Object.freeze({
  VIDEO:       'video',
  AUDIO:       'audio',
  IMAGE:       'image',
  DOCUMENT:    'document',
  ARCHIVE:     'archive',
  APPLICATION: 'application',
  OTHER:       'other',
});

// ── Category MIME / extension mapping ────────────────────────
export const CATEGORY_MAP = Object.freeze({
  video:       ['mp4','mkv','avi','mov','wmv','flv','webm','m4v','mpg','mpeg'],
  audio:       ['mp3','aac','flac','wav','ogg','m4a','wma','opus'],
  image:       ['jpg','jpeg','png','gif','webp','svg','bmp','ico','tiff'],
  document:    ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','csv','json','xml'],
  archive:     ['zip','rar','7z','tar','gz','bz2','xz','iso'],
  application: ['exe','msi','dmg','apk','deb','rpm','pkg'],
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
  STATE_SNAPSHOT:      'STATE_SNAPSHOT',

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
});

// ── Storage Keys ─────────────────────────────────────────────
export const STORAGE_KEY = Object.freeze({
  DOWNLOADS:   'all_downloader_downloads',
  SETTINGS:    'all_downloader_settings',
  STATS:       'all_downloader_stats',
});

// ── Default Settings ──────────────────────────────────────────
export const DEFAULT_SETTINGS = Object.freeze({
  maxConcurrent:       3,           // max simultaneous downloads
  maxChunks:           8,           // segments per file
  minChunkSizeMB:      2,           // min file size to chunk (MB)
  speedLimitKBps:      0,           // 0 = unlimited
  defaultSavePath:     '',          // empty = browser default
  autoStart:           true,        // auto-start queued downloads
  showNotifications:   true,        // OS notifications on complete
  verifyIntegrity:     true,        // SHA-256 check when server provides hash
  interceptDownloads:  true,        // intercept all browser downloads
  darkMode:            true,
  maxHistoryItems:     500,
});

// ── UI Config ─────────────────────────────────────────────────
export const UI = Object.freeze({
  POPUP_MAX_VISIBLE:   7,           // max download items in popup
  PROGRESS_INTERVAL:   500,         // ms between progress broadcasts
  SPEED_SAMPLE_WINDOW: 3000,        // ms window for speed average
});

// ── Color Palette ─────────────────────────────────────────────
export const COLORS = Object.freeze({
  skyBlue:  '#8ecae6',
  ocean:    '#219ebc',
  navy:     '#023047',
  amber:    '#ffb703',
  orange:   '#fb8500',
});
