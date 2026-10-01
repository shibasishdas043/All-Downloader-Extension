// ============================================================
//  All-Downloader — Download Engine URL / Header Probe
//  Industry-grade multi-tier probe with HEAD + GET Range fallback,
//  Content-Range total size parsing, and ETag/Last-Modified coherence
// ============================================================
import { hostGovernor } from './host-governor.js';
import type { ProbeMeta } from './types.js';

export const DEFAULT_HEAD_TIMEOUT_MS = 3_500;
export const DEFAULT_RANGE_TIMEOUT_MS = 4_500;

export async function probeUrl(
  url: string,
  signal: AbortSignal,
  timeoutMs = DEFAULT_HEAD_TIMEOUT_MS
): Promise<ProbeMeta> {
  const releaseProbeSlot = await hostGovernor.acquireProbeSlot(url, signal);

  try {
    const headCtrl = new AbortController();
    const timer = setTimeout(() => headCtrl.abort(), timeoutMs);
    const combined = combineSignals(signal, headCtrl.signal);

    let res: Response | null = null;
    let isRangeProbe = false;

    // 1. First probe tier: HEAD request (lightweight metadata)
    try {
      const headRes = await fetch(url, {
        method: 'HEAD',
        signal: combined,
        credentials: 'include',
        redirect: 'follow',
      });
      if (headRes.ok) {
        res = headRes;
      }
    } catch {
      // Network error or timeout on HEAD — will fall back to GET Range probe
    } finally {
      clearTimeout(timer);
    }

    // 2. Second probe tier: GET Range: bytes=0-0 fallback
    // Essential for CDNs (AWS CloudFront, Cloudflare, Google Drive, S3 presigned URLs)
    // that return 405 Method Not Allowed or 403 Forbidden to HEAD requests
    if (!res && !signal.aborted) {
      const getCtrl = new AbortController();
      const getTimer = setTimeout(() => getCtrl.abort(), DEFAULT_RANGE_TIMEOUT_MS);
      const getCombined = combineSignals(signal, getCtrl.signal);

      try {
        const getRes = await fetch(url, {
          method: 'GET',
          signal: getCombined,
          headers: { Range: 'bytes=0-0' },
          credentials: 'include',
          redirect: 'follow',
        });

        if (getRes.ok || getRes.status === 206) {
          res = getRes;
          isRangeProbe = true;
        }
      } catch {
        // Both HEAD and GET probe failed
      } finally {
        clearTimeout(getTimer);
      }
    }

  if (!res) {
    return {
      contentLength: 0,
      acceptsRanges: false,
      filename: null,
      mimeType: null,
      hashExpected: null,
      etag: null,
      lastModified: null,
    };
  }

  // Safely release response stream if body was opened in GET probe
  if (isRangeProbe && res.body) {
    try {
      await res.body.cancel();
    } catch {
      /* ignore cancel error */
    }
  }

  let contentLength = 0;
  let acceptsRanges = false;

  // Inspect Content-Range header (e.g. "bytes 0-0/52428800")
  const contentRange = res.headers.get('Content-Range') || '';
  const crMatch = contentRange.match(/bytes\s+\d+-\d+\/(\d+)/i);
  if (crMatch && crMatch[1]) {
    contentLength = parseInt(crMatch[1], 10);
    acceptsRanges = true; // Content-Range response proves range support
  }

  if (res.status === 206) {
    acceptsRanges = true;
  }

  if (!contentLength) {
    contentLength = parseContentLength(res);
  }

  const acceptRangesHdr = (res.headers.get('Accept-Ranges') || '').toLowerCase();
  if (acceptRangesHdr === 'bytes') {
    acceptsRanges = true;
  } else if (acceptRangesHdr === 'none') {
    acceptsRanges = false;
  }

  const filename = parseFilename(res, url);
  const rawContentType = res.headers.get('Content-Type') || '';
  const mimeType = rawContentType.split(';')[0].trim().toLowerCase() || null;

  // Cache & Resource Coherence Validators (RFC 7232)
  const etag = res.headers.get('ETag')?.trim() || null;
  const lastModified = res.headers.get('Last-Modified')?.trim() || null;

  // Check RFC 3230 / RFC 5843 / RFC 8941 Digest headers
  const digest = res.headers.get('Digest') || res.headers.get('Repr-Digest') || '';
  let hashExpected: string | null = null;
  const shaMatch = digest.match(/sha-?256=([A-Za-z0-9+/=]+)/i);
  if (shaMatch && shaMatch[1]) {
    hashExpected = shaMatch[1].trim();
  }

    return {
      contentLength,
      acceptsRanges,
      filename,
      mimeType,
      hashExpected,
      etag,
      lastModified,
    };
  } finally {
    releaseProbeSlot();
  }
}

export function parseContentLength(res: Response): number {
  const raw = res.headers.get('Content-Length');
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return isFinite(n) && n > 0 ? n : 0;
}

export function parseFilename(res: Response, url: string): string {
  const cd = res.headers.get('Content-Disposition') || '';

  // RFC 5987 / RFC 6266 filename*=UTF-8''filename.ext
  let m = cd.match(/filename\*\s*=\s*UTF-8''([^;\s]+)/i);
  if (m && m[1]) {
    try {
      return decodeURIComponent(m[1]).replace(/[/\\?%*:|"<>]/g, '_');
    } catch {
      /* fall through */
    }
  }

  // Standard filename="filename.ext" or filename=filename.ext
  m = cd.match(/filename\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s\n]+))/i);
  const matchedName = m ? (m[1] || m[2] || m[3] || '').trim() : '';
  if (matchedName) {
    return matchedName.replace(/[/\\?%*:|"<>]/g, '_');
  }

  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const last = segs[segs.length - 1];
    if (last) {
      return decodeURIComponent(last).replace(/[/\\?%*:|"<>]/g, '_');
    }
  } catch {
    /* ignore URL parse error */
  }

  return 'download';
}

export function combineSignals(s1: AbortSignal, s2: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  s1.addEventListener('abort', abort, { once: true });
  s2.addEventListener('abort', abort, { once: true });
  return ctrl.signal;
}
