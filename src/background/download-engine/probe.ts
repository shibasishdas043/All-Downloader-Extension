// ============================================================
//  All-Downloader — Download Engine URL / Header Probe
// ============================================================
import type { ProbeMeta } from './types.js';

export const DEFAULT_HEAD_TIMEOUT_MS = 10_000;

export async function probeUrl(url: string, signal: AbortSignal, timeoutMs = DEFAULT_HEAD_TIMEOUT_MS): Promise<ProbeMeta> {
  const headCtrl = new AbortController();
  const timer = setTimeout(() => headCtrl.abort(), timeoutMs);
  const combined = combineSignals(signal, headCtrl.signal);

  let res: Response | null = null;
  try {
    res = await fetch(url, {
      method: 'HEAD',
      signal: combined,
      credentials: 'include',
      redirect: 'follow',
    });
  } catch {
    try {
      res = await fetch(url, {
        method: 'GET',
        signal,
        headers: { Range: 'bytes=0-0' },
        credentials: 'include',
        redirect: 'follow',
      });
    } catch {
      return { contentLength: 0, acceptsRanges: false, filename: null, mimeType: null };
    }
  } finally {
    clearTimeout(timer);
  }

  if (!res || !res.ok) {
    return { contentLength: 0, acceptsRanges: false, filename: null, mimeType: null };
  }

  const contentLength = parseContentLength(res);
  const acceptsRanges = (res.headers.get('Accept-Ranges') || '').toLowerCase() === 'bytes';
  const filename = parseFilename(res, url);
  const rawContentType = res.headers.get('Content-Type') || '';
  const mimeType = rawContentType.split(';')[0].trim().toLowerCase() || null;

  // Check RFC 3230 / RFC 5843 Digest header (e.g. Digest: sha-256=...)
  const digest = res.headers.get('Digest') || res.headers.get('Repr-Digest') || '';
  let hashExpected: string | null = null;
  const shaMatch = digest.match(/sha-?256=([A-Za-z0-9+/=]+)/i);
  if (shaMatch && shaMatch[1]) {
    hashExpected = shaMatch[1].trim();
  }

  return { contentLength, acceptsRanges, filename, mimeType, hashExpected };
}

export function parseContentLength(res: Response): number {
  const raw = res.headers.get('Content-Length');
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return isFinite(n) && n > 0 ? n : 0;
}

export function parseFilename(res: Response, url: string): string {
  const cd = res.headers.get('Content-Disposition') || '';

  let m = cd.match(/filename\*\s*=\s*UTF-8''([^;\s]+)/i);
  if (m && m[1]) {
    try { return decodeURIComponent(m[1]); } catch { /* fall through */ }
  }

  m = cd.match(/filename\s*=\s*["']?([^;"'\n]+)["']?/i);
  if (m && m[1]) return m[1].trim();

  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const last = segs[segs.length - 1];
    if (last) return decodeURIComponent(last);
  } catch { /* ignore */ }

  return 'download';
}

export function combineSignals(s1: AbortSignal, s2: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  s1.addEventListener('abort', abort, { once: true });
  s2.addEventListener('abort', abort, { once: true });
  return ctrl.signal;
}
