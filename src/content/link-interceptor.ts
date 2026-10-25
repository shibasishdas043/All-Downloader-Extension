// ============================================================
//  All-Downloader — Content Script (Download Intent Interceptor - TypeScript)
//  Dynamically tracks right-click / Save As user intents
//  so native "Save image as..." / "Save link as..." downloads
//  are never intercepted into default folders.
// ============================================================

import { HoverFAB, type MediaInfo } from './hover-fab.js';

declare global {
  interface Window {
    __adlInjected?: boolean;
  }
}

(function () {
  'use strict';

  // Clean up any residual popup element if present
  try {
    document.getElementById('__adl-tooltip')?.remove();
  } catch {
    // ignore
  }

  // Only inject once
  if (window.__adlInjected) return;
  window.__adlInjected = true;

  // ── Track detected streams from main-world sniffer & background ────
  interface DetectedStreamEntry {
    url: string;
    title?: string;
    timestamp: number;
  }
  const detectedPageStreams: DetectedStreamEntry[] = [];

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'ALL_DOWNLOADER_SNIFFER') return;
    const payload = event.data.message?.payload;
    if (payload?.playlistUrl) {
      detectedPageStreams.unshift({
        url: payload.playlistUrl,
        title: payload.pageTitle || document.title,
        timestamp: Date.now(),
      });
      if (detectedPageStreams.length > 50) detectedPageStreams.pop();
      try {
        chrome.runtime.sendMessage(event.data.message).catch(() => {});
      } catch {}
    }
  });

  try {
    chrome.runtime?.sendMessage?.({ type: 'GET_TAB_MEDIA_STREAMS' }, (resp) => {
      if (chrome.runtime?.lastError) return;
      if (resp?.items && Array.isArray(resp.items)) {
        for (const item of resp.items) {
          if (item.url) {
            detectedPageStreams.push({
              url: item.url,
              title: item.filename || document.title,
              timestamp: item.timestamp || Date.now(),
            });
          }
        }
      }
    });
  } catch {}

  // ── Extract candidate URLs for Save As detection ────
  function extractUrlsFromPointAndElement(e: MouseEvent): string[] {
    const urls = new Set<string>();

    // Current page URL (crucial when image/media is opened directly in a new tab)
    if (window.location.href && window.location.href.startsWith('http')) {
      urls.add(window.location.href);
    }

    function addCandidate(raw: string | null | undefined) {
      if (!raw || typeof raw !== 'string') return;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:') || trimmed.startsWith('#')) return;
      try {
        const resolved = new URL(trimmed, window.location.href).href;
        urls.add(resolved);
      } catch {
        urls.add(trimmed);
      }
    }

    function inspectElement(el: Element | null) {
      if (!el || !(el instanceof HTMLElement || el instanceof SVGElement)) return;

      // 1. Tag-specific media and link sources
      if (el instanceof HTMLImageElement) {
        addCandidate(el.currentSrc);
        addCandidate(el.src);
        addCandidate(el.getAttribute('src'));
        const srcset = el.getAttribute('srcset') || el.srcset;
        if (srcset) {
          for (const part of srcset.split(',')) {
            const item = part.trim().split(/\s+/)[0];
            if (item) addCandidate(item);
          }
        }
      } else if (el instanceof HTMLAnchorElement) {
        addCandidate(el.href);
        addCandidate(el.getAttribute('href'));
      } else if (el instanceof HTMLMediaElement) {
        addCandidate(el.currentSrc);
        addCandidate(el.src);
        addCandidate(el.getAttribute('src'));
      } else if (el instanceof HTMLSourceElement) {
        addCandidate(el.src);
        addCandidate(el.getAttribute('src'));
        const srcset = el.getAttribute('srcset') || el.srcset;
        if (srcset) {
          for (const part of srcset.split(',')) {
            const item = part.trim().split(/\s+/)[0];
            if (item) addCandidate(item);
          }
        }
      } else if (el.tagName.toLowerCase() === 'image') {
        addCandidate(el.getAttribute('href') || el.getAttribute('xlink:href'));
      }

      // 2. Data attributes commonly used by modern image viewers, CDNs, lazy-loaders
      const dataAttributes = [
        'data-src', 'data-original', 'data-url', 'data-lazy-src',
        'data-highres', 'data-zoom-src', 'data-full-url', 'data-full',
        'data-large', 'data-original-src', 'data-source', 'data-download-url'
      ];
      for (const attr of dataAttributes) {
        addCandidate(el.getAttribute(attr));
      }

      // 3. CSS background-image
      try {
        const bg = window.getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none') {
          const matches = bg.matchAll(/url\(["']?([^"')]+)["']?\)/g);
          for (const m of matches) {
            if (m[1]) addCandidate(m[1]);
          }
        }
      } catch {
        // ignore
      }

      // 4. Enclosing picture element sources
      const pic = el.closest('picture');
      if (pic) {
        for (const s of Array.from(pic.querySelectorAll('source'))) {
          addCandidate(s.getAttribute('src'));
          const srcset = s.getAttribute('srcset');
          if (srcset) {
            for (const part of srcset.split(',')) {
              const item = part.trim().split(/\s+/)[0];
              if (item) addCandidate(item);
            }
          }
        }
      }

      // 5. Enclosing anchor tag
      const parentA = el.closest('a[href]') as HTMLAnchorElement | null;
      if (parentA) {
        addCandidate(parentA.href);
        addCandidate(parentA.getAttribute('href'));
      }
    }

    // A. Inspect all elements at the exact click point (penetrating overlay divs and wrappers)
    try {
      if (typeof document.elementsFromPoint === 'function') {
        const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
        for (const el of elementsAtPoint) {
          inspectElement(el);
        }
      }
    } catch {
      // ignore
    }

    // B. Inspect event target and its ancestor/descendant tree
    const target = e.target as HTMLElement | null;
    if (target) {
      inspectElement(target);
      let p: HTMLElement | null = target.parentElement;
      let depth = 0;
      while (p && depth < 4) {
        inspectElement(p);
        p = p.parentElement;
        depth++;
      }
      try {
        for (const child of Array.from(target.querySelectorAll('img, picture, video, audio, source, a[href]'))) {
          inspectElement(child);
        }
      } catch {
        // ignore
      }
    }

    return Array.from(urls);
  }

  // ══════════════════════════════════════════════════════════════
  //  Universal Right-Click & Copy Protection Unblocker (Content Script)
  //  Pierces transparent click shields, strips inline blocking attributes,
  //  injects high-priority selection styles, and syncs settings.
  // ══════════════════════════════════════════════════════════════
  let isUnblockRightClickEnabled = true;
  const STYLE_ID = '__adl_universal_unblock_styles';
  const BLOCKING_ATTRS = ['oncontextmenu', 'onselectstart', 'ondragstart', 'oncopy', 'oncut'];

  function injectUniversalUnblockStyles() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        /* All-Downloader — Universal Right-Click & Selection Unblocker */
        html, body, div, p, span, h1, h2, h3, h4, h5, h6, article, section, main, table, tr, td, th, pre, code, blockquote, li, ol, ul, dd, dt {
          -webkit-user-select: text !important;
          user-select: text !important;
        }
        img, video, audio, picture, canvas {
          -webkit-user-select: auto !important;
          user-select: auto !important;
          pointer-events: auto !important;
          -webkit-touch-callout: default !important;
        }
      `;
      (document.head || document.documentElement || document).appendChild(style);
    } catch {}
  }

  function removeUniversalUnblockStyles() {
    try {
      document.getElementById(STYLE_ID)?.remove();
    } catch {}
  }

  function cleanBlockingAttributes(root: Element | Document = document) {
    if (!isUnblockRightClickEnabled) return;
    try {
      if (root instanceof Element) {
        for (const attr of BLOCKING_ATTRS) {
          if (root.hasAttribute(attr)) root.removeAttribute(attr);
        }
      }
      const list = root.querySelectorAll?.(BLOCKING_ATTRS.map((a) => `[${a}]`).join(',')) || [];
      for (const el of Array.from(list)) {
        for (const attr of BLOCKING_ATTRS) {
          if (el.hasAttribute(attr)) el.removeAttribute(attr);
        }
      }
      if (document.documentElement) {
        for (const attr of BLOCKING_ATTRS) {
          if (document.documentElement.hasAttribute(attr)) document.documentElement.removeAttribute(attr);
        }
      }
      if (document.body) {
        for (const attr of BLOCKING_ATTRS) {
          if (document.body.hasAttribute(attr)) document.body.removeAttribute(attr);
        }
      }
    } catch {}
  }

  function pierceClickShields(e: MouseEvent) {
    if (!isUnblockRightClickEnabled) return;
    if (e.button !== 2) return;
    try {
      const elements = document.elementsFromPoint(e.clientX, e.clientY);
      if (!elements || elements.length < 2) return;

      const topEl = elements[0];
      if (
        topEl instanceof HTMLImageElement ||
        topEl instanceof HTMLVideoElement ||
        topEl instanceof HTMLCanvasElement ||
        topEl instanceof HTMLAnchorElement
      ) {
        return;
      }

      const mediaIndex = elements.slice(1, 6).findIndex((el) => {
        return (
          el instanceof HTMLImageElement ||
          el instanceof HTMLVideoElement ||
          el instanceof HTMLCanvasElement ||
          (el instanceof HTMLAnchorElement && Boolean(el.href))
        );
      });

      if (mediaIndex === -1) return;
      const shieldsToPierce = elements.slice(0, mediaIndex + 1);

      for (const el of shieldsToPierce) {
        if (
          el instanceof HTMLImageElement ||
          el instanceof HTMLVideoElement ||
          el instanceof HTMLCanvasElement ||
          el instanceof HTMLAnchorElement
        ) {
          break;
        }
        if (el.textContent?.trim()) break;

        const comp = window.getComputedStyle(el);
        const isTransparentBg =
          comp.backgroundColor === 'rgba(0, 0, 0, 0)' ||
          comp.backgroundColor === 'transparent' ||
          parseFloat(comp.opacity) === 0;
        const noBgImage = !comp.backgroundImage || comp.backgroundImage === 'none';

        if (isTransparentBg && noBgImage) {
          if (!(el as any).__adlOrigPointerEvents) {
            (el as any).__adlOrigPointerEvents = (el as HTMLElement).style.pointerEvents || '__EMPTY__';
          }
          (el as HTMLElement).style.setProperty('pointer-events', 'none', 'important');

          setTimeout(() => {
            try {
              const orig = (el as any).__adlOrigPointerEvents;
              delete (el as any).__adlOrigPointerEvents;
              if (orig && orig !== '__EMPTY__') {
                (el as HTMLElement).style.pointerEvents = orig;
              } else {
                (el as HTMLElement).style.removeProperty('pointer-events');
              }
            } catch {}
          }, 800);
        }
      }
    } catch {}
  }

  function syncRightClickConfig(enabled: boolean) {
    isUnblockRightClickEnabled = enabled;
    try {
      window.postMessage({
        source: 'ALL_DOWNLOADER_RIGHT_CLICK_CONFIG',
        unblockRightClick: enabled,
      }, '*');
    } catch {}

    if (enabled) {
      injectUniversalUnblockStyles();
      cleanBlockingAttributes();
    } else {
      removeUniversalUnblockStyles();
    }
  }

  // Attach capturing mouse listeners for transparent shield piercing
  window.addEventListener('mousedown', pierceClickShields, true);
  window.addEventListener('pointerdown', pierceClickShields, true);

  // Initialize unblocking immediately and on DOM readiness
  injectUniversalUnblockStyles();
  cleanBlockingAttributes();
  window.addEventListener('DOMContentLoaded', () => cleanBlockingAttributes(), { once: true });

  // Observe dynamically created elements to sanitize inline blocking attributes
  try {
    const blockerObserver = new MutationObserver((mutations) => {
      if (!isUnblockRightClickEnabled) return;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const target = mutation.target as Element;
          const attr = mutation.attributeName;
          if (attr && BLOCKING_ATTRS.includes(attr)) {
            target.removeAttribute(attr);
          }
        } else if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              cleanBlockingAttributes(node);
            }
          });
        }
      }
    });

    blockerObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: BLOCKING_ATTRS,
    });
  } catch {}

  // ── Track right-click contextmenu events across the page ──
  window.addEventListener('contextmenu', (e: MouseEvent) => {
    const urls = extractUrlsFromPointAndElement(e);
    try {
      chrome.runtime.sendMessage({
        type: 'USER_RIGHT_CLICKED',
        payload: {
          urls,
          pageUrl: window.location.href,
          timestamp: Date.now(),
        },
      }).catch(() => {});
    } catch {
      // ignore context invalidated
    }
  }, true);

  // ── User explicitly cancels context menu with Escape ──
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      try {
        chrome.runtime.sendMessage({
          type: 'USER_DISMISSED_CONTEXT_MENU',
          payload: {
            pageUrl: window.location.href,
            timestamp: Date.now(),
          },
        }).catch(() => {});
      } catch {
        // ignore
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      // User pressed Ctrl+S / Cmd+S (explicit Save As dialog)
      try {
        chrome.runtime.sendMessage({
          type: 'USER_RIGHT_CLICKED',
          payload: {
            urls: [window.location.href],
            pageUrl: window.location.href,
            timestamp: Date.now(),
          },
        }).catch(() => {});
      } catch {
        // ignore
      }
    }
  }, true);

  // ══════════════════════════════════════════════════════════════
  //  Feature: Hover-to-Grab Floating Action Button (Zero-Friction Media Grab)
  // ══════════════════════════════════════════════════════════════

  let fabInstance: HoverFAB | null = null;
  let isHoverGrabEnabled = true;
  let hoverTimeout: any = null;
  let leaveTimeout: any = null;
  let currentTargetEl: HTMLElement | null = null;

  // Sync Hover-Grab setting from storage
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get('all_downloader_settings', (res) => {
        const s = (res?.all_downloader_settings as any);
        if (s && typeof s.enableHoverGrab === 'boolean') {
          isHoverGrabEnabled = s.enableHoverGrab;
        }
        if (s && typeof s.unblockRightClick === 'boolean') {
          syncRightClickConfig(s.unblockRightClick);
        } else {
          syncRightClickConfig(true);
        }
      });

      chrome.storage.onChanged?.addListener((changes, area) => {
        if (area === 'local' && changes.all_downloader_settings?.newValue) {
          const s = (changes.all_downloader_settings.newValue as any);
          if (typeof s.enableHoverGrab === 'boolean') {
            isHoverGrabEnabled = s.enableHoverGrab;
            if (!isHoverGrabEnabled && fabInstance) {
              fabInstance.hide();
              currentTargetEl = null;
            }
          }
          if (typeof s.unblockRightClick === 'boolean') {
            syncRightClickConfig(s.unblockRightClick);
          }
        }
      });
    }
  } catch {
    // context or permissions fallback
  }

  function getFab(): HoverFAB {
    if (!fabInstance) {
      fabInstance = new HoverFAB();
    }
    return fabInstance;
  }

  function enhanceCdnImageUrl(url: string): string {
    if (!url || typeof url !== 'string') return url;
    try {
      // 1. Generic HTML entity unescaping
      const cleaned = url.replace(/&amp;/g, '&');
      const parsed = new URL(cleaned);

      // 2. Generic query parameter downscaling removal across modern/future CDNs
      const downscaleParams = [
        'w', 'width', 'h', 'height', 'resize', 'size', 'max_width', 'max_height',
        'fit', 'crop', 'thumb', 'thumbnail', 'quality'
      ];
      for (const p of downscaleParams) {
        if (parsed.searchParams.has(p)) {
          const val = parsed.searchParams.get(p) || '';
          if (/^\d{1,4}(?:x\d{1,4})?$/i.test(val) || /^(?:small|thumb|preview|mini|tiny|low)$/i.test(val)) {
            parsed.searchParams.delete(p);
          }
        }
      }

      // If CDN uses 'name' parameter for size presets, upgrade to original
      if (parsed.searchParams.has('name')) {
        const nameVal = (parsed.searchParams.get('name') || '').toLowerCase();
        if (['small', 'medium', 'thumb', '120x120', '360x360', 'large'].includes(nameVal)) {
          parsed.searchParams.set('name', 'orig');
        }
      }

      // 3. Generic path dimension & thumbnail suffix normalization
      parsed.pathname = parsed.pathname
        .replace(/\/\d{2,4}x(?:\d{2,4})?\//g, '/originals/')
        .replace(/([a-zA-Z0-9_-]{4,})(?:[-_](?:thumb|small|preview|thumbnail|mini))(\.[a-z0-9]{2,5})$/i, '$1$2');

      return parsed.href;
    } catch {
      return url;
    }
  }

  function getUrlExtension(url: string): string {
    try {
      const path = new URL(url).pathname;
      const lastDot = path.lastIndexOf('.');
      if (lastDot > 0) {
        const ext = path.slice(lastDot + 1).toLowerCase();
        if (ext.length >= 2 && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) {
          return ext;
        }
      }
    } catch {}
    return '';
  }

  function extractFilenameFromUrl(url: string, fallbackExt: string): string {
    try {
      const path = new URL(url).pathname;
      const filename = path.split('/').pop()?.trim();
      if (filename && filename.includes('.')) {
        return filename;
      }
    } catch {}
    const safeTitle = (document.title || 'media')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 40)
      .replace(/^_+|_+$/g, '');
    return `${safeTitle || 'download'}_${Date.now()}.${fallbackExt}`;
  }

  function resolveBestImageUrl(img: HTMLImageElement): string | null {
    // 1. Parse srcset for largest width descriptor
    const rawSrcset = img.getAttribute('srcset') || img.srcset;
    if (rawSrcset) {
      const parts = rawSrcset.split(',').map(s => s.trim()).filter(Boolean);
      let bestSrc = '';
      let maxScore = 0;
      for (const part of parts) {
        const tokens = part.split(/\s+/);
        const url = tokens[0];
        const desc = tokens[1] || '';
        let score = 1;
        if (desc.endsWith('w')) {
          score = parseInt(desc.slice(0, -1), 10) || 1;
        } else if (desc.endsWith('x')) {
          score = (parseFloat(desc.slice(0, -1)) || 1) * 1000;
        }
        if (score > maxScore) {
          maxScore = score;
          bestSrc = url;
        }
      }
      if (bestSrc) {
        try {
          return enhanceCdnImageUrl(new URL(bestSrc, window.location.href).href);
        } catch {
          return enhanceCdnImageUrl(bestSrc);
        }
      }
    }

    // 2. Check high-res data attributes
    const highResAttrs = [
      'data-original', 'data-highres', 'data-zoom-src',
      'data-full-url', 'data-large', 'data-src', 'data-download-url',
    ];
    for (const attr of highResAttrs) {
      const val = img.getAttribute(attr);
      if (val && !val.startsWith('data:')) {
        try {
          return enhanceCdnImageUrl(new URL(val, window.location.href).href);
        } catch {
          return enhanceCdnImageUrl(val);
        }
      }
    }

    // 3. Fallback to currentSrc or src
    const candidate = img.currentSrc || img.src || img.getAttribute('src');
    if (candidate && !candidate.startsWith('data:')) {
      try {
        return enhanceCdnImageUrl(new URL(candidate, window.location.href).href);
      } catch {
        return enhanceCdnImageUrl(candidate);
      }
    }

    return null;
  }

  function resolveMediaInfo(el: HTMLElement): MediaInfo | null {
    // 1. Video
    if (el instanceof HTMLVideoElement) {
      let src = el.currentSrc || el.src;
      if (!src) {
        const source = el.querySelector('source');
        if (source) src = source.src || source.getAttribute('src') || '';
      }

      let isStream = false;
      let effectiveUrl = src;

      // If video has blob: or data: or no direct src, look up detected page streams
      if (!effectiveUrl || effectiveUrl.startsWith('blob:') || effectiveUrl.startsWith('data:')) {
        if (detectedPageStreams.length > 0) {
          effectiveUrl = detectedPageStreams[0].url;
          isStream = true;
        }
      }

      if (effectiveUrl && !effectiveUrl.startsWith('blob:') && !effectiveUrl.startsWith('data:')) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 48 || rect.height < 48) return null;

        let resolution = '';
        if (el.videoHeight) {
          resolution =
            el.videoHeight >= 2160 ? '4K' :
            el.videoHeight >= 1440 ? '2K' :
            el.videoHeight >= 1080 ? '1080p' :
            el.videoHeight >= 720 ? '720p' :
            el.videoHeight >= 480 ? '480p' :
            `${el.videoWidth || 0}×${el.videoHeight}`;
        } else if (isStream) {
          resolution = 'Adaptive HD';
        }

        const ext = isStream ? 'mp4' : (getUrlExtension(effectiveUrl) || 'mp4');
        return {
          url: effectiveUrl,
          type: 'video',
          ext,
          resolution,
          filename: extractFilenameFromUrl(effectiveUrl, ext),
          isStream,
        };
      }
    }

    // 2. Image
    if (el instanceof HTMLImageElement) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) return null;
      if (el.naturalWidth && el.naturalWidth < 40) return null;
      if (el.naturalHeight && el.naturalHeight < 40) return null;

      const bestUrl = resolveBestImageUrl(el);
      if (bestUrl && !bestUrl.startsWith('data:image/gif;base64,R0lGODlhAQABA')) {
        let resolution = '';
        if (el.naturalWidth && el.naturalHeight) {
          resolution = `${el.naturalWidth}×${el.naturalHeight}`;
        }
        const ext = getUrlExtension(bestUrl) || 'jpg';
        return {
          url: bestUrl,
          type: 'image',
          ext,
          resolution,
          filename: extractFilenameFromUrl(bestUrl, ext),
        };
      }
    }

    // 3. Canvas
    if (el instanceof HTMLCanvasElement) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 64 || rect.height < 64 || el.width < 64 || el.height < 64) return null;
      try {
        const dataUrl = el.toDataURL('image/png');
        if (dataUrl && dataUrl.length > 100) {
          return {
            url: dataUrl,
            type: 'canvas',
            ext: 'png',
            resolution: `${el.width}×${el.height}`,
            filename: `canvas_${Date.now()}.png`,
          };
        }
      } catch {
        return null;
      }
    }

    // 4. Audio
    if (el instanceof HTMLAudioElement) {
      const src = el.currentSrc || el.src;
      if (src && !src.startsWith('blob:') && !src.startsWith('data:')) {
        const ext = getUrlExtension(src) || 'mp3';
        return {
          url: src,
          type: 'audio',
          ext,
          filename: extractFilenameFromUrl(src, ext),
        };
      }
    }

    // 5. CSS Background Image
    try {
      const style = window.getComputedStyle(el);
      const bg = style.backgroundImage;
      if (bg && bg !== 'none') {
        const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (match && match[1]) {
          const rect = el.getBoundingClientRect();
          if (rect.width >= 64 && rect.height >= 64) {
            const rawUrl = match[1];
            const resolved = new URL(rawUrl, window.location.href).href;
            const ext = getUrlExtension(resolved) || 'jpg';
            return {
              url: resolved,
              type: 'image',
              ext,
              filename: extractFilenameFromUrl(resolved, ext),
            };
          }
        }
      }
    } catch {}

    return null;
  }

  function findMediaTarget(clientX: number, clientY: number): { element: HTMLElement; media: MediaInfo } | null {
    if (typeof document.elementsFromPoint !== 'function') return null;

    let elements: Element[] = [];
    try {
      elements = document.elementsFromPoint(clientX, clientY);
    } catch {
      return null;
    }

    for (const el of elements) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.id === '__adl-fab-host' || el.closest('#__adl-fab-host')) continue;

      // 1. Direct hit on media element
      const direct = resolveMediaInfo(el);
      if (direct) {
        return { element: el, media: direct };
      }

      // 2. Search for video inside current container
      const innerVideo = el.querySelector('video') as HTMLVideoElement | null;
      if (innerVideo) {
        const rect = innerVideo.getBoundingClientRect();
        if (rect.width >= 48 && rect.height >= 48) {
          const media = resolveMediaInfo(innerVideo);
          if (media) return { element: innerVideo, media };
        }
      }

      // 3. Search in shadowRoot if present
      if (el.shadowRoot) {
        const shadowVideo = el.shadowRoot.querySelector('video') as HTMLVideoElement | null;
        if (shadowVideo) {
          const rect = shadowVideo.getBoundingClientRect();
          if (rect.width >= 48 && rect.height >= 48) {
            const media = resolveMediaInfo(shadowVideo);
            if (media) return { element: shadowVideo, media };
          }
        }
      }

      // 4. Check dynamic player wrapper ancestors up to 6 levels (framework/tag-agnostic)
      let parent: HTMLElement | null = el.parentElement;
      let depth = 0;
      while (parent && depth < 6) {
        const wrapperVideo = parent.querySelector('video') as HTMLVideoElement | null;
        if (wrapperVideo) {
          const rect = wrapperVideo.getBoundingClientRect();
          if (rect.width >= 48 && rect.height >= 48) {
            const media = resolveMediaInfo(wrapperVideo);
            if (media) return { element: wrapperVideo, media };
          }
        }
        if (parent.shadowRoot) {
          const shadowV = parent.shadowRoot.querySelector('video') as HTMLVideoElement | null;
          if (shadowV) {
            const rect = shadowV.getBoundingClientRect();
            if (rect.width >= 48 && rect.height >= 48) {
              const media = resolveMediaInfo(shadowV);
              if (media) return { element: shadowV, media };
            }
          }
        }
        parent = parent.parentElement;
        depth++;
      }
    }

    return null;
  }

  // Pointer Movement Hit Detection
  document.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isHoverGrabEnabled) return;

    // Do not interfere while user is hovering or clicking the FAB itself
    if (fabInstance?.isHovered()) return;

    const hit = findMediaTarget(e.clientX, e.clientY);
    if (!hit) {
      if (fabInstance?.getVisible()) {
        clearTimeout(leaveTimeout);
        leaveTimeout = setTimeout(() => {
          if (!fabInstance?.isHovered()) {
            fabInstance?.hide();
            currentTargetEl = null;
          }
        }, 150);
      }
      clearTimeout(hoverTimeout);
      return;
    }

    clearTimeout(leaveTimeout);

    // If already displaying for this element, avoid reposition thrashing
    if (currentTargetEl === hit.element && fabInstance?.getVisible()) {
      return;
    }

    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      currentTargetEl = hit.element;
      const rect = hit.element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        getFab().show(rect, hit.media);
      }
    }, 300);
  }, { passive: true });

  // Hide on page scroll
  document.addEventListener('scroll', () => {
    if (fabInstance?.getVisible() && !fabInstance.isHovered()) {
      fabInstance.hide();
      currentTargetEl = null;
    }
  }, { passive: true });

  // Hide when cursor leaves window
  document.addEventListener('pointerleave', () => {
    clearTimeout(hoverTimeout);
    if (fabInstance && !fabInstance.isHovered()) {
      fabInstance.hide();
      currentTargetEl = null;
    }
  }, { passive: true });
})();

