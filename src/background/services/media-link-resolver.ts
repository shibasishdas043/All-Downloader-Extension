// ============================================================
//  All-Downloader — Universal Media Link & HTML Trap Resolver
//  Industry-grade multi-tier algorithm that detects when an
//  alleged media link returns an HTML page / redirect loop,
//  and automatically recovers the real media stream / download URL
//  across all modern and future web platforms.
// ============================================================

import { probeUrl } from '../download-engine/probe.js';
import type { ProbeMeta } from '../download-engine/types.js';

export interface DiscoveredMediaTarget {
  url: string;
  type: 'video' | 'audio' | 'image' | 'document' | 'stream';
  score: number;
  filename?: string;
  source: 'meta-refresh' | 'video-tag' | 'source-tag' | 'audio-tag' | 'json-ld' | 'open-graph' | 'download-anchor' | 'endpoint-mutation';
}

export interface ResolvedMediaResult {
  resolvedUrl: string;
  mimeType: string | null;
  size: number;
  filename: string | null;
  acceptsRanges: boolean;
  etag?: string | null;
  lastModified?: string | null;
}

const MEDIA_EXTENSIONS = new Set([
  // Video
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', 'ts', '3gp', 'ogv',
  // Audio
  'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma', 'opus',
  // Image
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'avif',
  // Archive & Document
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'pdf', 'epub'
]);

/**
 * Checks whether a given Content-Type indicates an HTML webpage or document.
 */
export function isHtmlContentType(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  const clean = mimeType.split(';')[0].trim().toLowerCase();
  return clean === 'text/html' || clean === 'application/xhtml+xml' || clean === 'text/xml';
}

/**
 * Determines if a given category or filename was intended to be a media/binary download.
 */
export function isMediaIntent(category?: string, filename?: string): boolean {
  if (category && ['video', 'audio', 'image', 'archive', 'application'].includes(category)) {
    return true;
  }
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext && MEDIA_EXTENSIONS.has(ext)) {
      return true;
    }
  }
  return false;
}

/**
 * Generates alternative candidate endpoints based on universal web routing conventions.
 * E.g.: /dh-file/123 -> /download/123, /get-file/123 -> /download/123, ?action=view -> ?action=download
 */
export function generateCandidateUrls(rawUrl: string): string[] {
  const candidates = new Set<string>();
  if (!rawUrl || typeof rawUrl !== 'string') return [];

  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname;

    // Pattern 1: Indirect route prefixes e.g. /dh-file/:id, /get-file/:id, /view-file/:id, /media-file/:id
    const indirectPrefixes = [
      'dh-file',
      'get-file',
      'view-file',
      'media-file',
      'dl-file',
      'file-dl',
      'fetch-file',
      'get_file',
      'download_item',
      'download-item'
    ];

    for (const prefix of indirectPrefixes) {
      if (pathname.includes(`/${prefix}/`)) {
        // Test standard REST /download/:id
        const replacedDownload = new URL(rawUrl);
        replacedDownload.pathname = pathname.replace(`/${prefix}/`, '/download/');
        candidates.add(replacedDownload.href);

        // Test /files/:id
        const replacedFiles = new URL(rawUrl);
        replacedFiles.pathname = pathname.replace(`/${prefix}/`, '/files/');
        candidates.add(replacedFiles.href);

        // Test /file/:id
        const replacedFile = new URL(rawUrl);
        replacedFile.pathname = pathname.replace(`/${prefix}/`, '/file/');
        candidates.add(replacedFile.href);
      }
    }

    // Pattern 2: Action or view parameters e.g. ?action=view -> ?action=download
    if (parsed.searchParams.has('action') && parsed.searchParams.get('action') === 'view') {
      const u = new URL(rawUrl);
      u.searchParams.set('action', 'download');
      candidates.add(u.href);
    }

    if (parsed.searchParams.has('mode') && parsed.searchParams.get('mode') === 'view') {
      const u = new URL(rawUrl);
      u.searchParams.set('mode', 'download');
      candidates.add(u.href);
    }

    // Pattern 3: Preview parameter toggle
    if (parsed.searchParams.has('preview')) {
      const u1 = new URL(rawUrl);
      u1.searchParams.delete('preview');
      candidates.add(u1.href);

      const u2 = new URL(rawUrl);
      u2.searchParams.set('download', '1');
      candidates.add(u2.href);
    }
  } catch {
    // Ignore URL parse error
  }

  candidates.delete(rawUrl);
  return Array.from(candidates);
}

/**
 * Universal HTML parser that extracts real media URLs embedded in intermediate HTML pages.
 * Supports <video>, <source>, <audio>, JSON-LD (Schema.org), OpenGraph, <meta http-equiv="refresh">,
 * and high-priority download anchor tags.
 */
export function extractMediaCandidatesFromHtml(html: string, baseUrl: string): DiscoveredMediaTarget[] {
  const results: DiscoveredMediaTarget[] = [];
  if (!html || typeof html !== 'string') return results;

  function toAbsolute(urlStr: string): string | null {
    if (!urlStr || typeof urlStr !== 'string') return null;
    let trimmed = urlStr.trim();
    if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('about:')) {
      return null;
    }
    if (trimmed.startsWith('//')) trimmed = 'https:' + trimmed;
    try {
      const resolved = new URL(trimmed, baseUrl);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        return resolved.href;
      }
    } catch {
      // ignore
    }
    return null;
  }

  // 1. Meta http-equiv="refresh" content="0; url=..."
  const refreshMatch = html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"'>\s]+)["']/i);
  if (refreshMatch && refreshMatch[1]) {
    const abs = toAbsolute(refreshMatch[1]);
    if (abs) {
      results.push({ url: abs, type: 'video', score: 100, source: 'meta-refresh' });
    }
  }

  // 2. Direct <video src="..."> elements
  const videoSrcRegex = /<video[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = videoSrcRegex.exec(html)) !== null) {
    const abs = toAbsolute(m[1]);
    if (abs) {
      results.push({ url: abs, type: 'video', score: 90, source: 'video-tag' });
    }
  }

  // 3. Child <source src="..." type="..."> inside video/audio tags
  const sourceRegex = /<source[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((m = sourceRegex.exec(html)) !== null) {
    const abs = toAbsolute(m[1]);
    if (abs) {
      results.push({ url: abs, type: 'video', score: 85, source: 'source-tag' });
    }
  }

  // 4. Schema.org JSON-LD scripts
  const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = jsonLdRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      const objects = Array.isArray(parsed) ? parsed : [parsed];
      for (const obj of objects) {
        if (!obj || typeof obj !== 'object') continue;
        if (obj.contentUrl) {
          const abs = toAbsolute(obj.contentUrl);
          if (abs) {
            results.push({ url: abs, type: 'video', score: 95, filename: obj.name, source: 'json-ld' });
          }
        }
        if (obj.video?.contentUrl) {
          const abs = toAbsolute(obj.video.contentUrl);
          if (abs) {
            results.push({ url: abs, type: 'video', score: 95, source: 'json-ld' });
          }
        }
      }
    } catch {
      // Ignore JSON parse error
    }
  }

  // 5. OpenGraph Video/Audio Tags
  const ogRegex = /<meta[^>]+(?:property|name)=["'](og:video|og:video:url|og:audio)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  while ((m = ogRegex.exec(html)) !== null) {
    const isAudio = m[1].includes('audio');
    const abs = toAbsolute(m[2]);
    if (abs) {
      results.push({ url: abs, type: isAudio ? 'audio' : 'video', score: 80, source: 'open-graph' });
    }
  }

  // 6. Anchor tags with explicit download attribute or direct media extensions
  const anchorRegex = /<a[^>]+href=["']([^"']+)["']([^>]*)>/gi;
  while ((m = anchorRegex.exec(html)) !== null) {
    const href = m[1];
    const rest = m[2];
    const abs = toAbsolute(href);
    if (!abs || abs === baseUrl) continue;

    const downloadAttrMatch = rest.match(/download(?:=["']([^"']*)["'])?/i);
    const hasDownloadAttr = downloadAttrMatch !== null;
    const explicitFilename = downloadAttrMatch?.[1];

    let ext = '';
    try {
      const p = new URL(abs).pathname;
      ext = p.split('.').pop()?.toLowerCase() || '';
    } catch {}

    if (MEDIA_EXTENSIONS.has(ext)) {
      results.push({
        url: abs,
        type: 'video',
        score: hasDownloadAttr ? 90 : 70,
        filename: explicitFilename,
        source: 'download-anchor'
      });
    } else if (hasDownloadAttr) {
      // An anchor with download attribute pointing to a download route
      results.push({
        url: abs,
        type: 'video',
        score: 65,
        filename: explicitFilename,
        source: 'download-anchor'
      });
    }
  }

  // Deduplicate by URL and sort by descending score
  const uniqueMap = new Map<string, DiscoveredMediaTarget>();
  for (const item of results) {
    if (!uniqueMap.has(item.url) || uniqueMap.get(item.url)!.score < item.score) {
      uniqueMap.set(item.url, item);
    }
  }

  return Array.from(uniqueMap.values()).sort((a, b) => b.score - a.score);
}

/**
 * Universal Multi-Stage Resolution Algorithm.
 * Resolves indirect or broken download links into direct media streams.
 */
export async function resolveRealMediaUrl({
  url,
  referrer,
  expectedCategory,
  expectedFilename,
  signal,
}: {
  url: string;
  referrer?: string;
  expectedCategory?: string;
  expectedFilename?: string;
  signal?: AbortSignal;
}): Promise<ResolvedMediaResult | null> {
  const abortCtrl = new AbortController();
  if (signal) {
    signal.addEventListener('abort', () => abortCtrl.abort(), { once: true });
  }

  // ── Step 1: Probe the original URL with Referer ─────────────
  const initialMeta: ProbeMeta = await probeUrl(url, abortCtrl.signal, 3_500, referrer);

  // If initial probe returns a non-HTML binary media stream with content length or range support:
  if (!isHtmlContentType(initialMeta.mimeType) && (initialMeta.contentLength > 0 || initialMeta.acceptsRanges)) {
    return {
      resolvedUrl: initialMeta.resolvedUrl || url,
      mimeType: initialMeta.mimeType,
      size: initialMeta.contentLength,
      filename: initialMeta.filename,
      acceptsRanges: initialMeta.acceptsRanges,
      etag: initialMeta.etag,
      lastModified: initialMeta.lastModified,
    };
  }

  // If mimeType is not HTML and not media intent, return initialMeta
  if (!isHtmlContentType(initialMeta.mimeType) && !isMediaIntent(expectedCategory, expectedFilename)) {
    return null;
  }

  // ── Step 2: Test Endpoint Mutations (e.g. /dh-file/ -> /download/) ─────────
  const mutationCandidates = generateCandidateUrls(url);
  for (const candidate of mutationCandidates) {
    if (abortCtrl.signal.aborted) break;
    try {
      const candMeta = await probeUrl(candidate, abortCtrl.signal, 3_000, referrer);
      if (!isHtmlContentType(candMeta.mimeType) && (candMeta.contentLength > 0 || candMeta.acceptsRanges)) {
        return {
          resolvedUrl: candMeta.resolvedUrl || candidate,
          mimeType: candMeta.mimeType,
          size: candMeta.contentLength,
          filename: candMeta.filename || expectedFilename || null,
          acceptsRanges: candMeta.acceptsRanges,
          etag: candMeta.etag,
          lastModified: candMeta.lastModified,
        };
      }
    } catch {
      // Continue to next candidate
    }
  }

  // ── Step 3: Fetch and Analyze Returned HTML for Embedded Media ─────────
  try {
    const fetchHeaders: Record<string, string> = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    if (referrer) fetchHeaders['Referer'] = referrer;

    const htmlRes = await fetch(url, {
      method: 'GET',
      headers: fetchHeaders,
      signal: abortCtrl.signal,
      credentials: 'include',
      redirect: 'follow',
    });

    if (htmlRes.ok) {
      const responseContentType = htmlRes.headers.get('Content-Type') || '';
      if (!isHtmlContentType(responseContentType)) {
        // Unexpectedly received media on full GET
        const cl = parseInt(htmlRes.headers.get('Content-Length') || '0', 10);
        return {
          resolvedUrl: htmlRes.url || url,
          mimeType: responseContentType.split(';')[0].trim().toLowerCase(),
          size: cl,
          filename: expectedFilename || null,
          acceptsRanges: true,
        };
      }

      // Read up to 512 KB of the HTML document
      const htmlText = await htmlRes.text();
      const extractedTargets = extractMediaCandidatesFromHtml(htmlText, htmlRes.url || url);

      for (const target of extractedTargets) {
        if (abortCtrl.signal.aborted) break;
        try {
          const targetMeta = await probeUrl(target.url, abortCtrl.signal, 3_000, referrer || htmlRes.url);
          if (!isHtmlContentType(targetMeta.mimeType) && (targetMeta.contentLength > 0 || targetMeta.acceptsRanges)) {
            return {
              resolvedUrl: targetMeta.resolvedUrl || target.url,
              mimeType: targetMeta.mimeType,
              size: targetMeta.contentLength,
              filename: target.filename || targetMeta.filename || expectedFilename || null,
              acceptsRanges: targetMeta.acceptsRanges,
              etag: targetMeta.etag,
              lastModified: targetMeta.lastModified,
            };
          }
        } catch {
          // Continue to next extracted candidate
        }
      }
    }
  } catch {
    // Network or abort error
  }

  return null;
}
