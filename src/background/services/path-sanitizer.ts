// ============================================================
//  All-Downloader — Path & Filename Sanitization Service
// ============================================================

export function sanitizeFilename(name: string): string {
  if (!name || typeof name !== 'string') return 'download';

  let safe = name
    .replace(/\0/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  safe = safe.replace(/^\.+$/, '_');

  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(safe)) {
    safe = '_' + safe;
  }

  if (safe.length > 200) {
    const ext = safe.lastIndexOf('.');
    const extPart = ext > 0 ? safe.slice(ext) : '';
    const namePart = ext > 0 ? safe.slice(0, 200 - extPart.length) : safe.slice(0, 200);
    safe = namePart + extPart;
  }

  return safe || 'download';
}

export function sanitizeFolderSegment(seg: string): string {
  if (!seg || typeof seg !== 'string') return '';

  let safe = seg
    .replace(/\0/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^\.+$/.test(safe)) return '';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(safe)) return '';
  if (safe.length > 100) safe = safe.slice(0, 100);

  return safe;
}

export function buildSavePath(subFolder: string, filename: string): string {
  if (!subFolder || typeof subFolder !== 'string' || !subFolder.trim()) {
    return filename;
  }

  const cleanFolder = subFolder
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .map(seg => sanitizeFolderSegment(seg))
    .filter(Boolean)
    .join('/');

  return cleanFolder ? `${cleanFolder}/${filename}` : filename;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
