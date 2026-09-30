// ============================================================
//  All-Downloader — Active Download Registry
// ============================================================
import type { ActiveRegistryEntry } from './types.js';

const _registry = new Map<string, ActiveRegistryEntry>();

export function getRegistryEntry(downloadId: string): ActiveRegistryEntry | undefined {
  return _registry.get(downloadId);
}

export function setRegistryEntry(downloadId: string, entry: ActiveRegistryEntry): void {
  _registry.set(downloadId, entry);
}

export function deleteRegistryEntry(downloadId: string): boolean {
  return _registry.delete(downloadId);
}

export function cancelExistingDownload(downloadId: string): void {
  const prev = _registry.get(downloadId);
  if (prev) {
    prev.controller.abort();
    _registry.delete(downloadId);
  }
}
