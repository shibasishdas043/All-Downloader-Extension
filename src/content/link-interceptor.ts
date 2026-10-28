// ============================================================
//  All-Downloader — Content Script (Download Intent Interceptor - TypeScript)
//  Dynamically tracks right-click / Save As user intents
//  so native "Save image as..." / "Save link as..." downloads
//  are never intercepted into default folders.
// ============================================================

export {};

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

  // Sync unblockRightClick setting from storage
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get('all_downloader_settings', (res) => {
        const s = (res?.all_downloader_settings as any);
        if (s && typeof s.unblockRightClick === 'boolean') {
          syncRightClickConfig(s.unblockRightClick);
        } else {
          syncRightClickConfig(true);
        }
      });

      chrome.storage.onChanged?.addListener((changes, area) => {
        if (area === 'local' && changes.all_downloader_settings?.newValue) {
          const s = (changes.all_downloader_settings.newValue as any);
          if (typeof s.unblockRightClick === 'boolean') {
            syncRightClickConfig(s.unblockRightClick);
          }
        }
      });
    }
  } catch {
    // context or permissions fallback
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

})();

