// ============================================================
//  All-Downloader — Right Click & Save As Detector Service
//  Dynamically identifies user-initiated "Save As" / right-click
//  downloads (images, links, media, archives, documents, etc.)
//  so they are NOT intercepted and forced to default settings.
//  Completely format-agnostic: supports ALL current & future files!
// ============================================================

export interface RightClickRecord {
  urls: string[];
  pageUrl: string;
  timestamp: number;
}

const GENERIC_FILENAMES = new Set([
  '',
  'index',
  'index.html',
  'index.htm',
  'index.php',
  'download',
  'download.php',
  'file',
  'default',
  'view',
  'preview',
]);

export function cleanUrl(raw: string): string {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    return u.href;
  } catch {
    return raw.split('#')[0];
  }
}

export function stripQuery(raw: string): string {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    return u.href;
  } catch {
    return raw.split('?')[0].split('#')[0];
  }
}

export function getFilename(raw: string): string {
  if (!raw) return '';
  if (raw.includes('\\') || /^[a-zA-Z]:/.test(raw)) {
    const parts = raw.split(/[/\\]/).filter(Boolean);
    const last = parts[parts.length - 1] || '';
    return decodeURIComponent(last.split('?')[0].split('#')[0]);
  }
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    return decodeURIComponent(last.split('?')[0].split('#')[0]);
  } catch {
    const parts = raw.split(/[/\\]/).filter(Boolean);
    const last = parts[parts.length - 1] || '';
    return decodeURIComponent(last.split('?')[0].split('#')[0]);
  }
}

export function getFileExt(filename: string): string {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.substring(dot + 1).toLowerCase() : '';
}

export function getBaseStem(filename: string): string {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.substring(0, dot) : filename;
  return base.replace(/[-_](thumb|small|medium|large|preview|\d+x\d+|\d+w|\d+p)$/i, '').toLowerCase();
}

export function isGenericFilename(filename: string): boolean {
  if (!filename) return true;
  const lower = filename.trim().toLowerCase();
  return lower.length < 3 || GENERIC_FILENAMES.has(lower);
}

export function urlsMatch(itemUrl: string, candidateUrl: string): boolean {
  if (!itemUrl || !candidateUrl) return false;

  // 1. Direct equality
  if (itemUrl === candidateUrl) return true;

  // 2. Strip fragment (#) match
  const cItem = cleanUrl(itemUrl);
  const cCand = cleanUrl(candidateUrl);
  if (cItem === cCand) return true;

  // 3. Strip query string match (for CDNs with varying tokens or cache-busters)
  const sqItem = stripQuery(itemUrl);
  const sqCand = stripQuery(candidateUrl);
  if (sqItem === sqCand) return true;

  // 4. Origin & pathname match
  try {
    const uItem = new URL(itemUrl);
    const uCand = new URL(candidateUrl);

    if (uItem.origin === uCand.origin && uItem.pathname === uCand.pathname) {
      return true;
    }

    const fnItem = getFilename(itemUrl);
    const fnCand = getFilename(candidateUrl);

    // 5. Origin matches and filenames match
    if (uItem.origin === uCand.origin && fnItem && fnCand) {
      if (fnItem.toLowerCase() === fnCand.toLowerCase()) {
        return true;
      }
      // Base stem match on same origin (e.g. thumb vs full image or responsive asset)
      const stemItem = getBaseStem(fnItem);
      const stemCand = getBaseStem(fnCand);
      if (stemItem && stemCand && stemItem === stemCand && stemItem.length >= 3) {
        return true;
      }
    }

    // 6. Cross-origin filename match for any non-generic file
    // (e.g. Page loaded asset from site.com, right-click downloads from cdn.site.com or external mirror)
    if (fnItem && fnCand && fnItem.toLowerCase() === fnCand.toLowerCase()) {
      if (!isGenericFilename(fnItem)) {
        return true;
      }
    }
  } catch {
    // Ignore URL parsing errors
  }

  return false;
}

export class RightClickDetector {
  public records: RightClickRecord[] = [];
  private ttlMs: number;

  constructor(ttlMs = 60000) {
    this.ttlMs = ttlMs;
  }

  public record(urls: string[], pageUrl: string): void {
    const now = Date.now();
    this.prune(now);
    if (!urls.length && !pageUrl) return;
    this.records.push({
      urls: urls.filter(Boolean),
      pageUrl: pageUrl || '',
      timestamp: now,
    });
  }

  public dismiss(pageUrl: string): void {
    // User explicitly cancelled / dismissed context menu (e.g. Escape key)
    this.records = this.records.filter((r) => r.pageUrl !== pageUrl);
  }

  public consume(url: string): void {
    const now = Date.now();
    this.prune(now);
    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i];
      if (urlsMatch(url, r.pageUrl) || r.urls.some((u) => urlsMatch(url, u))) {
        this.records.splice(i, 1);
        return;
      }
    }
  }

  public isRightClickDownload(item: {
    url?: string;
    finalUrl?: string;
    referrer?: string;
    filename?: string;
    mime?: string;
  }): boolean {
    const now = Date.now();
    this.prune(now);

    const downloadUrls = [item.url, item.finalUrl].filter(Boolean) as string[];
    if (!downloadUrls.length) return false;

    const itemFilename = item.filename ? getFilename(item.filename) : getFilename(item.url || '');

    for (let i = 0; i < this.records.length; i++) {
      const record = this.records[i];

      for (const dlUrl of downloadUrls) {
        // Direct candidate match
        for (const candidate of record.urls) {
          if (urlsMatch(dlUrl, candidate)) {
            this.records.splice(i, 1);
            return true;
          }
        }

        // Direct pageUrl match (user opened image/file in new tab or pressed Ctrl+S)
        if (urlsMatch(dlUrl, record.pageUrl)) {
          this.records.splice(i, 1);
          return true;
        }

        // Referrer match + filename match
        if (item.referrer && urlsMatch(item.referrer, record.pageUrl)) {
          for (const candidate of record.urls) {
            const candFn = getFilename(candidate);
            if (itemFilename && candFn && itemFilename.toLowerCase() === candFn.toLowerCase()) {
              this.records.splice(i, 1);
              return true;
            }
          }
        }

        // Direct filename match against candidate list for any non-generic file
        if (itemFilename && !isGenericFilename(itemFilename)) {
          for (const candidate of record.urls) {
            const candFn = getFilename(candidate);
            if (candFn && candFn.toLowerCase() === itemFilename.toLowerCase()) {
              this.records.splice(i, 1);
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  private prune(now: number): void {
    this.records = this.records.filter((r) => now - r.timestamp < this.ttlMs);
  }
}
