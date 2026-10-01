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
