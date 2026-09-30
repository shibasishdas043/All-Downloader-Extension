// ============================================================
//  All-Downloader — Download Engine Types
// ============================================================
import type { DownloadItem, ExtensionSettings, DownloadResult } from '../../shared/types.js';
import type { SpeedSnapshot } from '../speed-tracker.js';

export interface SegmentDescriptor {
  index: number;
  start: number;
  end: number;
  received: number;
  done: boolean;
}

export interface ActiveRegistryEntry {
  controller: AbortController;
  segments: SegmentDescriptor[];
}

export type ProgressCallback = (id: string, received: number, total: number, speedSnap: SpeedSnapshot) => void;
export type CompleteCallback = (id: string, result: DownloadResult, filename: string) => Promise<void> | void;
export type ErrorCallback = (id: string, errorMessage: string) => void;
export type MetaCallback = (meta: { filename: string; mimeType: string | null; totalSize: number }) => Promise<void> | void;

export interface ProgressState {
  received: number;
  total: number;
  lastBroadcast: number;
}

export interface ProbeMeta {
  contentLength: number;
  acceptsRanges: boolean;
  filename: string | null;
  mimeType: string | null;
}

export interface SingleDownloadParams {
  download: DownloadItem;
  fallbackMime?: string;
  controller: AbortController;
  throttle: (bytes: number) => Promise<void>;
  progress: ProgressState;
  emit: () => void;
}

export interface ChunkedDownloadParams {
  download: DownloadItem;
  totalSize: number;
  mimeType: string;
  settings: ExtensionSettings;
  controller: AbortController;
  throttle: (bytes: number) => Promise<void>;
  progress: ProgressState;
  emit: () => void;
}

export interface SegmentFetchParams {
  download: DownloadItem;
  seg: SegmentDescriptor;
  controller: AbortController;
  throttle: (bytes: number) => Promise<void>;
  progress: ProgressState;
  emit: () => void;
}
