// ============================================================
//  All-Downloader — Industry-Grade Page Media & Resource Sniffer
//  Multi-pass deep scanner for images, videos, audio, documents,
//  and downloadable archives across modern SPAs, Shadow DOMs,
//  Web Components, CSS backgrounds, JSON-LD, and OpenGraph meta.
// ============================================================
import type { SniffedMediaItem } from '../../shared/types.js';

/**
 * Scrapes all downloadable media and resources from the active webpage.
 * NOTE: This function must be 100% self-contained as it is injected and
 * serialized via chrome.scripting.executeScript({ func: scrapePageMediaAndLinks }).
 */
export function scrapePageMediaAndLinks(): SniffedMediaItem[] {
  const itemsMap = new Map<string, SniffedMediaItem>();

  const IMAGE_EXTS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
    'tiff', 'tif', 'avif', 'heic', 'heif', 'raw', 'psd'
  ]);
  const VIDEO_EXTS = new Set([
    'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v',
    'ts', '3gp', 'ogv', 'm3u8', 'mpd', 'f4m', 'ism', 'vob', 'divx'
  ]);
  const AUDIO_EXTS = new Set([
    'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma', 'opus',
    'alac', 'aiff', 'mid', 'midi'
  ]);
  const DOC_EXTS = new Set([
    'pdf', 'epub', 'mobi', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'odt', 'ods', 'odp', 'txt', 'rtf', 'csv', 'tsv', 'md',
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst',
    'iso', 'img', 'dmg', 'vhd', 'bin', 'exe', 'msi', 'apk',
    'deb', 'rpm', 'pkg', 'torrent', 'vtt', 'srt'
  ]);

  function isTrackingBeacon(url: string, w?: number, h?: number): boolean {
    if (w !== undefined && h !== undefined && w > 0 && h > 0 && w <= 16 && h <= 16) {
      return true;
    }
    const lower = url.toLowerCase();
    if (
      lower.includes('/pixel.gif') ||
      lower.includes('/beacon.gif') ||
      lower.includes('spacer.gif') ||
      lower.includes('cleardot.gif') ||
      lower.includes('/tr?') ||
      lower.includes('google-analytics.com/collect') ||
      lower.includes('facebook.com/tr') ||
      lower.includes('doubleclick.net')
    ) {
      return true;
    }
    return false;
  }

  function formatResolution(w?: number, h?: number): string | undefined {
    if (!w || !h || w <= 0 || h <= 0) return undefined;
    if (w >= 3840 && h >= 2160) return `${w}×${h} (4K UHD)`;
    if (w >= 2560 && h >= 1440) return `${w}×${h} (2K QHD)`;
    if (w >= 1920 && h >= 1080) return `${w}×${h} (FHD)`;
    if (w >= 1280 && h >= 720) return `${w}×${h} (HD)`;
    return `${w}×${h}`;
  }

  function resolveFilenameAndExt(
    fullUrl: string,
    explicitFilename?: string,
    fallbackTitle?: string
  ): { filename: string; ext: string } {
    let filename = '';
    let ext = '';

    // 1. Explicit filename (e.g. from anchor `download` attribute)
    if (explicitFilename && explicitFilename.trim()) {
      const clean = explicitFilename.trim().replace(/[<>:"/\\|?*]/g, '_');
      const dotIdx = clean.lastIndexOf('.');
      if (dotIdx > 0 && dotIdx < clean.length - 1) {
        filename = clean;
        ext = clean.substring(dotIdx + 1).toLowerCase();
      } else {
        filename = clean;
      }
    }

    // 2. Query param extraction (e.g. ?file=report.pdf or ?name=photo.jpg)
    if (!ext) {
      try {
        const parsed = new URL(fullUrl);
        const searchParams = parsed.searchParams;
        const candidateKeys = ['file', 'filename', 'name', 'attachment', 'attachment_filename', 'fn', 'doc', 'download'];
        for (const k of candidateKeys) {
          const val = searchParams.get(k);
          if (val) {
            const cleanVal = decodeURIComponent(val).trim().replace(/[<>:"/\\|?*]/g, '_');
            const dotIdx = cleanVal.lastIndexOf('.');
            if (dotIdx > 0 && dotIdx < cleanVal.length - 1) {
              const testExt = cleanVal.substring(dotIdx + 1).toLowerCase();
              if (IMAGE_EXTS.has(testExt) || VIDEO_EXTS.has(testExt) || AUDIO_EXTS.has(testExt) || DOC_EXTS.has(testExt)) {
                filename = cleanVal;
                ext = testExt;
                break;
              }
            }
          }
        }
      } catch {
        // Ignore URL parse error
      }
    }

    // 3. Pathname segment extraction
    if (!ext) {
      try {
        const parsed = new URL(fullUrl);
        const parts = parsed.pathname.split('/');
        const lastPart = parts.pop() || '';
        const decoded = decodeURIComponent(lastPart).trim().replace(/[<>:"/\\|?*]/g, '_');
        const dotIdx = decoded.lastIndexOf('.');
        if (dotIdx > 0 && dotIdx < decoded.length - 1) {
          ext = decoded.substring(dotIdx + 1).toLowerCase();
          if (!filename) filename = decoded;
        } else if (!filename && decoded) {
          filename = decoded;
        }
      } catch {
        if (!filename) filename = 'download';
      }
    }

    // 4. Streaming manifests check (e.g. .m3u8, .mpd)
    if (!ext) {
      const lowerUrl = fullUrl.toLowerCase();
      if (lowerUrl.includes('.m3u8')) ext = 'm3u8';
      else if (lowerUrl.includes('.mpd')) ext = 'mpd';
      else if (lowerUrl.includes('.ism/manifest')) ext = 'ism';
    }

    // 5. Fallback clean filename if empty or generic
    const isGeneric = !filename || ['download', 'index', 'media', 'file', 'image', 'video'].includes(filename.toLowerCase());
    if (isGeneric) {
      const titleClean = fallbackTitle ? fallbackTitle.trim().slice(0, 40).replace(/[<>:"/\\|?*#\s]/g, '_') : '';
      const base = titleClean || 'resource';
      filename = ext ? `${base}.${ext}` : base;
    } else if (ext && !filename.toLowerCase().endsWith(`.${ext}`)) {
      filename = `${filename}.${ext}`;
    }

    return { filename, ext };
  }

  function addResource(
    url: string | null | undefined,
    options: {
      title?: string;
      defaultType: 'image' | 'video' | 'audio' | 'document' | 'link';
      explicitFilename?: string;
      width?: number;
      height?: number;
      origin?: string;
    }
  ): void {
    if (!url || typeof url !== 'string') return;
    const trimmed = url.trim();
    if (
      !trimmed ||
      trimmed.startsWith('javascript:') ||
      trimmed.startsWith('about:') ||
      trimmed.startsWith('mailto:') ||
      trimmed.startsWith('tel:') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('blob:')
    ) {
      return;
    }

    // Ignore tiny or transparent data URLs (user wants downloadable assets)
    if (trimmed.startsWith('data:')) {
      return;
    }

    let fullUrl = '';
    try {
      fullUrl = new URL(trimmed, document.baseURI || window.location.href).href;
    } catch {
      return;
    }

    if (isTrackingBeacon(fullUrl, options.width, options.height)) {
      return;
    }

    const { filename, ext } = resolveFilenameAndExt(fullUrl, options.explicitFilename, options.title);

    let resolvedType = options.defaultType;
    if (IMAGE_EXTS.has(ext)) resolvedType = 'image';
    else if (VIDEO_EXTS.has(ext)) resolvedType = 'video';
    else if (AUDIO_EXTS.has(ext)) resolvedType = 'audio';
    else if (DOC_EXTS.has(ext)) resolvedType = 'document';

    // Only include generic links if they have a recognized downloadable extension or explicit download attribute
    if (options.defaultType === 'link' && resolvedType === 'link' && !ext && !options.explicitFilename) {
      return;
    }

    if (resolvedType === 'link') {
      resolvedType = 'document';
    }

    const resolution = formatResolution(options.width, options.height);

    if (itemsMap.has(fullUrl)) {
      const existing = itemsMap.get(fullUrl)!;
      // Merge: upgrade resolution or title if better
      if (!existing.resolution && resolution) {
        existing.resolution = resolution;
        existing.width = options.width;
        existing.height = options.height;
      }
      if ((!existing.title || existing.title === existing.filename) && options.title) {
        existing.title = options.title;
      }
      if (existing.type === 'document' && (resolvedType === 'image' || resolvedType === 'video' || resolvedType === 'audio')) {
        existing.type = resolvedType;
      }
      return;
    }

    itemsMap.set(fullUrl, {
      url: fullUrl,
      filename,
      title: options.title || filename,
      type: resolvedType,
      ext: ext || undefined,
      width: options.width,
      height: options.height,
      resolution,
      origin: options.origin,
    });
  }

  function parseSrcset(srcsetStr: string): Array<{ url: string; width?: number }> {
    const list: Array<{ url: string; width?: number }> = [];
    if (!srcsetStr) return list;
    const parts = srcsetStr.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const tokens = trimmed.split(/\s+/);
      const candUrl = tokens[0];
      let width: number | undefined;
      if (tokens[1]) {
        const match = tokens[1].match(/^(\d+)w$/i);
        if (match) width = parseInt(match[1], 10);
      }
      if (candUrl) list.push({ url: candUrl, width });
    }
    return list;
  }

  function extractCssUrls(cssVal: string): string[] {
    if (!cssVal || cssVal === 'none') return [];
    const urls: string[] = [];
    const regex = /url\(\s*(?:['"]?)(.*?)(?:['"]?)\s*\)/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(cssVal)) !== null) {
      const u = m[1]?.trim();
      if (u && !u.startsWith('data:')) {
        urls.push(u);
      }
    }
    return urls;
  }

  function processElement(el: Element): void {
    const tagName = el.tagName.toUpperCase();

    // 1. Image Elements
    if (tagName === 'IMG') {
      const img = el as HTMLImageElement;
      const title = img.alt || img.title || '';
      const w = img.naturalWidth || img.width || img.clientWidth || undefined;
      const h = img.naturalHeight || img.height || img.clientHeight || undefined;

      const src = img.currentSrc || img.src || img.getAttribute('src');
      if (src) {
        addResource(src, { title, defaultType: 'image', width: w, height: h, origin: 'img' });
      }

      // Responsive srcset
      const srcset = img.getAttribute('srcset') || img.srcset;
      if (srcset) {
        for (const item of parseSrcset(srcset)) {
          addResource(item.url, { title, defaultType: 'image', width: item.width || w, height: h, origin: 'srcset' });
        }
      }

      // Lazy-loading attributes (used by CDNs and modern frameworks)
      const lazyAttrs = [
        'data-src', 'data-original', 'data-lazy-src', 'data-zoom-src',
        'data-full', 'data-full-url', 'data-hi-res', 'data-highres',
        'data-large', 'data-url', 'data-fallback-src'
      ];
      for (const attr of lazyAttrs) {
        const lazyVal = img.getAttribute(attr);
        if (lazyVal) {
          addResource(lazyVal, { title, defaultType: 'image', width: w, height: h, origin: 'lazy-img' });
        }
      }

      const lazySrcset = img.getAttribute('data-srcset');
      if (lazySrcset) {
        for (const item of parseSrcset(lazySrcset)) {
          addResource(item.url, { title, defaultType: 'image', width: item.width || w, height: h, origin: 'lazy-srcset' });
        }
      }
      return;
    }

    // 2. Video Elements
    if (tagName === 'VIDEO') {
      const video = el as HTMLVideoElement;
      const title = video.title || el.getAttribute('aria-label') || '';
      const w = video.videoWidth || video.clientWidth || undefined;
      const h = video.videoHeight || video.clientHeight || undefined;

      const src = video.currentSrc || video.src || video.getAttribute('src');
      if (src) {
        addResource(src, { title, defaultType: 'video', width: w, height: h, origin: 'video' });
      }

      // High-resolution video poster frame
      const poster = video.poster || video.getAttribute('poster');
      if (poster) {
        addResource(poster, { title: `${title} (Poster)`, defaultType: 'image', width: w, height: h, origin: 'poster' });
      }
      return;
    }

    // 3. Audio Elements
    if (tagName === 'AUDIO') {
      const audio = el as HTMLAudioElement;
      const title = audio.title || el.getAttribute('aria-label') || '';
      const src = audio.currentSrc || audio.src || audio.getAttribute('src');
      if (src) {
        addResource(src, { title, defaultType: 'audio', origin: 'audio' });
      }
      return;
    }

    // 4. Source & Track tags (Child of Video / Audio / Picture)
    if (tagName === 'SOURCE') {
      const parentTag = el.parentElement?.tagName.toUpperCase();
      const src = el.getAttribute('src');
      const srcset = el.getAttribute('srcset');
      const typeAttr = (el.getAttribute('type') || '').toLowerCase();

      let targetType: 'image' | 'video' | 'audio' = 'video';
      let origin = 'source';
      if (parentTag === 'AUDIO' || typeAttr.startsWith('audio/')) {
        targetType = 'audio';
        origin = 'audio-source';
      } else if (parentTag === 'PICTURE' || typeAttr.startsWith('image/')) {
        targetType = 'image';
        origin = 'picture-source';
      } else {
        targetType = 'video';
        origin = 'video-source';
      }

      if (src) {
        addResource(src, { defaultType: targetType, origin });
      }
      if (srcset) {
        for (const item of parseSrcset(srcset)) {
          addResource(item.url, { defaultType: targetType, width: item.width, origin });
        }
      }
      return;
    }

    if (tagName === 'TRACK') {
      const src = el.getAttribute('src');
      const label = el.getAttribute('label') || 'Subtitle';
      if (src) {
        addResource(src, { title: label, defaultType: 'document', origin: 'subtitle' });
      }
      return;
    }

    // 5. Anchors and Links
    if (tagName === 'A' || tagName === 'AREA') {
      const a = el as HTMLAnchorElement;
      const href = a.href || a.getAttribute('href');
      const downloadAttr = a.getAttribute('download') || undefined;
      const text = (a.textContent || a.title || a.getAttribute('aria-label') || downloadAttr || '').trim();
      if (href) {
        addResource(href, {
          title: text,
          defaultType: 'link',
          explicitFilename: downloadAttr,
          origin: 'link',
        });
      }
    }

    // 6. CSS Background Images
    const htmlEl = el as HTMLElement;
    // Check inline style first
    const inlineBg = htmlEl.style?.backgroundImage;
    if (inlineBg) {
      for (const bgUrl of extractCssUrls(inlineBg)) {
        addResource(bgUrl, {
          title: htmlEl.title || '',
          defaultType: 'image',
          width: htmlEl.clientWidth || undefined,
          height: htmlEl.clientHeight || undefined,
          origin: 'css-bg',
        });
      }
    }

    // For significant visual containers, check computed style
    const containerTags = new Set(['DIV', 'SECTION', 'HEADER', 'SPAN', 'A', 'FIGURE', 'ARTICLE', 'MAIN', 'ASIDE']);
    if (containerTags.has(tagName) && htmlEl.clientWidth >= 48 && htmlEl.clientHeight >= 48) {
      try {
        const computed = window.getComputedStyle(el).backgroundImage;
        if (computed && computed !== 'none' && computed !== inlineBg) {
          for (const bgUrl of extractCssUrls(computed)) {
            addResource(bgUrl, {
              title: htmlEl.title || '',
              defaultType: 'image',
              width: htmlEl.clientWidth,
              height: htmlEl.clientHeight,
              origin: 'css-computed',
            });
          }
        }
      } catch {
        // Ignored
      }
    }
  }

  // --- PASS 1: Recursive DOM & Open Shadow Root Traversal ---
  const visited = new Set<Node>();
  function walk(node: Node | null): void {
    if (!node || visited.has(node)) return;
    visited.add(node);

    if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
      const el = node as Element;
      processElement(el);

      // Deep Shadow DOM traversal for Web Components & modern players
      if (el.shadowRoot) {
        walk(el.shadowRoot);
      }

      // Same-origin iframe traversal
      if (el.tagName === 'IFRAME') {
        try {
          const doc = (el as HTMLIFrameElement).contentDocument;
          if (doc) walk(doc.body || doc);
        } catch {
          // Cross-origin iframe security error ignored
        }
      }
    }

    for (let i = 0; i < node.childNodes.length; i++) {
      walk(node.childNodes[i]);
    }
  }

  // Traverse body and document tree
  if (document.body) {
    walk(document.body);
  }

  // --- PASS 2: Head Metadata, OpenGraph & Preload Tags ---
  if (document.head) {
    const metaTags = document.head.querySelectorAll('meta, link');
    metaTags.forEach((tag) => {
      if (tag.tagName === 'META') {
        const prop = (tag.getAttribute('property') || tag.getAttribute('name') || '').toLowerCase();
        const content = tag.getAttribute('content');
        if (!content) return;

        if (prop.startsWith('og:image') || prop === 'twitter:image' || prop === 'twitter:image:src') {
          addResource(content, { title: 'Social Share Preview', defaultType: 'image', origin: 'meta-og' });
        } else if (prop.startsWith('og:video') || prop === 'twitter:player:stream') {
          addResource(content, { title: 'Social Video Preview', defaultType: 'video', origin: 'meta-og' });
        } else if (prop.startsWith('og:audio')) {
          addResource(content, { title: 'Social Audio Preview', defaultType: 'audio', origin: 'meta-og' });
        }
      } else if (tag.tagName === 'LINK') {
        const rel = (tag.getAttribute('rel') || '').toLowerCase();
        const href = tag.getAttribute('href');
        const as = (tag.getAttribute('as') || '').toLowerCase();
        if (!href) return;

        if (rel === 'image_src') {
          addResource(href, { defaultType: 'image', origin: 'link-meta' });
        } else if (rel === 'preload') {
          if (as === 'image') addResource(href, { defaultType: 'image', origin: 'preload' });
          else if (as === 'video') addResource(href, { defaultType: 'video', origin: 'preload' });
          else if (as === 'audio') addResource(href, { defaultType: 'audio', origin: 'preload' });
        }
      }
    });

    // --- PASS 3: Schema.org JSON-LD Structured Data ---
    const jsonLdScripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    jsonLdScripts.forEach((script) => {
      try {
        const json = JSON.parse(script.textContent || '');
        const parseObject = (obj: any): void => {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) {
            obj.forEach(parseObject);
            return;
          }

          const type = (obj['@type'] || '').toString().toLowerCase();
          const name = obj.name || obj.headline || '';

          if (type.includes('image') || obj.image) {
            const imgUrl = typeof obj.image === 'string' ? obj.image : obj.image?.url || obj.contentUrl || obj.url;
            if (typeof imgUrl === 'string') {
              addResource(imgUrl, { title: name, defaultType: 'image', origin: 'json-ld' });
            }
          }
          if (obj.thumbnailUrl || obj.thumbnail) {
            const thumbUrl = typeof obj.thumbnailUrl === 'string' ? obj.thumbnailUrl : (typeof obj.thumbnail === 'string' ? obj.thumbnail : obj.thumbnail?.url);
            if (typeof thumbUrl === 'string') {
              addResource(thumbUrl, { title: `${name} (Thumbnail)`.trim(), defaultType: 'image', origin: 'json-ld' });
            }
          }
          if (type.includes('video') || obj.video) {
            const vidUrl = typeof obj.video === 'string' ? obj.video : obj.video?.contentUrl || obj.contentUrl || obj.embedUrl;
            if (typeof vidUrl === 'string') {
              addResource(vidUrl, { title: name, defaultType: 'video', origin: 'json-ld' });
            }
          }
          if (type.includes('audio') || obj.audio) {
            const audUrl = typeof obj.audio === 'string' ? obj.audio : obj.audio?.contentUrl || obj.contentUrl;
            if (typeof audUrl === 'string') {
              addResource(audUrl, { title: name, defaultType: 'audio', origin: 'json-ld' });
            }
          }

          // Walk nested properties
          for (const k of Object.keys(obj)) {
            if (typeof obj[k] === 'object') parseObject(obj[k]);
          }
        };
        parseObject(json);
      } catch {
        // Invalid JSON-LD ignored
      }
    });
  }

  return Array.from(itemsMap.values());
}
