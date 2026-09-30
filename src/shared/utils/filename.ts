// ============================================================
//  All-Downloader — Filename & Path Utilities
// ============================================================

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
