// ============================================================
//  All-Downloader — Type Definitions
// ============================================================

// ── Routing Rule Types ────────────────────────────────────────
export type RuleConditionField = 'domain' | 'category' | 'url_pattern' | 'ext' | 'filename' | 'title' | 'mime';
export type RuleConditionOp    = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'regex' | 'in' | 'not_in';
export type RuleAction         = 'route_to' | 'rename' | 'both';

export interface RoutingRuleCondition {
  field: RuleConditionField;
  op: RuleConditionOp;
  /** Comma-separated list for 'in' operator; plain string for others */
  value: string;
}

export interface RoutingRule {
  id: string;
  /** Human-readable name shown in the UI */
  name: string;
  enabled: boolean;
  /** Lower value = evaluated first */
  priority: number;
  /** ALL conditions must match (AND logic) */
  conditions: RoutingRuleCondition[];
  action: RuleAction;
  /** Save path template, may contain tokens like {domain}, {date}, etc. */
  savePath?: string;
  /** Filename template, may contain tokens like {original_name}, {ext}, etc. */
  filenameTemplate?: string;
}

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
  resolvedUrl?: string;
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
  isHlsStream?: boolean;
  hlsSegmentCount?: number;
  hlsSegmentsCompleted?: number;
  hlsPlaylistUrl?: string;
  hlsTotalDuration?: number;
  pageTitle?: string;
  smartCategory?: string;
  smartFolder?: string;
  smartShelfKey?: string;
  smartBadge?: {
    label: string;
    icon: string;
    folder: string;
    shelfKey?: string;
    color?: string;
  };
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
  autoCheckUpdates?: boolean;
  /** Master on/off toggle for Smart Routing Rules */
  enableRoutingRules: boolean;
  /** Ordered list of routing rules (sorted by priority ascending) */
  routingRules: RoutingRule[];
  /** Master on/off toggle for Hover Grab floating action button on web media */
  enableHoverGrab?: boolean;
  /** Master on/off toggle for Contextual Intent Smart Routing (default: true) */
  enableSmartRouting?: boolean;
  /** Dynamic organization hierarchy mode */
  smartRoutingStructure?: 'contextual' | 'domain' | 'category' | 'date';
  /** Whether to normalize cryptic server filenames using detected page metadata */
  smartFilenameClean?: boolean;
  /** Master on/off toggle for Universal Right-Click & Copy Protection Unblocking (default: true) */
  unblockRightClick?: boolean;
}

export interface UpdateCheckResult {
  ok: boolean;
  status: string;
  version?: string;
  currentVersion: string;
  message: string;
}

export interface UpdateStatus {
  currentVersion: string;
  pendingVersion: string | null;
  pendingAt: number | null;
  lastCheckTime: number | null;
  lastCheckStatus: string | null;
  lastCheckMessage: string | null;
  hasActiveDownloads: boolean;
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
  referrer?: string;
}

export interface ExtensionStats {
  totalDownloadedBytes: number;
  totalCompletedFiles: number;
  totalFailedFiles: number;
}
