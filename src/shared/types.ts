// ============================================================
//  All-Downloader — Type Definitions
// ============================================================

export type DownloadState =
  | 'queued'
  | 'connecting'
  | 'downloading'
  | 'paused'
  | 'merging'
  | 'verifying'
  | 'completed'
  | 'error'
  | 'cancelled';

export type FileCategory =
  | 'video'
  | 'audio'
  | 'image'
  | 'document'
  | 'archive'
  | 'application'
  | 'other';

export interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  total: number;
  loaded: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  blob?: Blob;
}

export interface DownloadResult {
  chunkCount: number;
  totalSize: number;
  mimeType?: string;
}

export interface DownloadItem {
  id: string;
  url: string;
  filename: string;
  filesize: number;
  receivedBytes: number;
  progress: number;
  speed: number;
  eta: number | null;
  status: DownloadState;
  state?: DownloadState;
  category: FileCategory;
  mimeType?: string | null;
  createdAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
  errorMessage?: string | null;
  error?: string | null;
  resumable?: boolean;
  chunks?: ChunkInfo[];
  segments?: any[];
  totalChunks?: number;
  hashExpected?: string | null;
  hashActual?: string | null;
  hashVerified?: boolean | null;
  etag?: string | null;
  lastModified?: string | null;
  savePath?: string;
  chromeDownloadId?: number | null;
  scheduledTime?: number | null;
  scheduledAt?: number | null;
  isReadyToSave?: boolean;
  chunkCount?: number;
  chunked?: boolean;
  total?: number;
  received?: number;
  percent?: number;
  referrer?: string;
  autoReconnecting?: boolean;
}

export interface ExtensionSettings {
  maxConcurrent: number;
  maxChunks: number;
  minChunkSizeMB: number;
  speedLimitKBps: number;
  defaultSavePath: string;
  autoStart: boolean;
  showNotifications: boolean;
  verifyIntegrity: boolean;
  interceptDownloads: boolean;
  preserveChunksOnCancel: boolean;
  organizeByCategoryFolders: boolean;
  darkMode: boolean;
  maxHistoryItems: number;
  hideChromeShelf?: boolean;
}

export interface SniffedMediaItem {
  url: string;
  filename: string;
  title: string;
  type: 'image' | 'video' | 'audio' | 'document' | 'link';
  size?: number | null;
  ext?: string;
  width?: number;
  height?: number;
  resolution?: string;
  origin?: string;
}

export interface ExtensionStats {
  totalDownloadedBytes: number;
  totalCompletedFiles: number;
  totalFailedFiles: number;
}
