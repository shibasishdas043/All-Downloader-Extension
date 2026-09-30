// ============================================================
//  All-Downloader — General Helper Utilities
// ============================================================

export function generateId(): string {
  return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function calcPercent(received: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((received / total) * 100));
}

export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000)      return 'Just now';
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)} hr ago`;
  return new Date(timestamp).toLocaleDateString();
}
