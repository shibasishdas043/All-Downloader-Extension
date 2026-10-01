// ============================================================
//  All-Downloader — Content Script (Link Interceptor - TypeScript)
//  Injects "Download with All-Downloader" button on page links
//  and dynamically tracks right-click / Save As user intents
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

  // Only inject once
  if (window.__adlInjected) return;
  window.__adlInjected = true;

  let tooltip: HTMLDivElement | null = null;
  let activeAnchor: HTMLAnchorElement | null = null;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Create floating download button tooltip ──────────────
  function createTooltip(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = '__adl-tooltip';
    el.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      background: #023047;
      color: #8ecae6;
      border: 1px solid rgba(142,202,230,0.35);
      border-radius: 7px;
      padding: 5px 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.45);
      transition: opacity 0.15s ease, transform 0.15s ease;
      opacity: 0;
      pointer-events: none;
      white-space: nowrap;
      user-select: none;
    `;
    el.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 2v13M7 11l5 5 5-5"/>
        <path d="M3 18h18"/>
      </svg>
      Download with ADL
    `;
    const container = document.body || document.documentElement;
    if (container) container.appendChild(el);
    return el;
  }

  function showTooltip(anchor: HTMLAnchorElement, x: number, y: number): void {
    if (!tooltip) tooltip = createTooltip();

    if (hideTimeout) clearTimeout(hideTimeout);
    activeAnchor = anchor;

    tooltip.style.left = `${x + 10}px`;
    tooltip.style.top = `${y - 30}px`;
    tooltip.style.opacity = '1';
    tooltip.style.pointerEvents = 'auto';
    tooltip.style.transform = 'translateY(0)';
  }

  function hideTooltip(): void {
    if (!tooltip) return;
    tooltip.style.opacity = '0';
    tooltip.style.transform = 'translateY(-4px)';
    tooltip.style.pointerEvents = 'none';

    hideTimeout = setTimeout(() => {
      activeAnchor = null;
    }, 200);
  }

  // ── Detect downloadable link (format-agnostic) ────────────
  const WEB_PAGE_EXTS = new Set([
    'html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'cgi', 'action', 'do', 'pl'
  ]);

  function isDownloadLink(anchor: HTMLAnchorElement | null): boolean {
    if (!anchor) return false;

    // 1. Explicit download attribute (<a href="..." download>)
    if (anchor.hasAttribute('download')) return true;

    const href = anchor.getAttribute('href');
    if (!href) return false;

    try {
      const url = new URL(href, location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

      // 2. Any non-webpage file extension (universal for all files & future formats)
      const pathname = url.pathname;
      const lastDot = pathname.lastIndexOf('.');
      if (lastDot > 0 && lastDot < pathname.length - 1) {
        const ext = pathname.substring(lastDot + 1).toLowerCase();
        if (/^[a-z0-9]{2,8}$/.test(ext) && !WEB_PAGE_EXTS.has(ext)) {
          return true;
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  // ── Delegate mouseover to links ───────────────────────────
  document.addEventListener('mouseover', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const a = target?.closest('a[href]') as HTMLAnchorElement | null;
    if (!a) return;

    if (!isDownloadLink(a)) return;

    showTooltip(a, e.clientX, e.clientY);
  });

  document.addEventListener('mouseout', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const a = target?.closest('a[href]');
    if (!a) return;

    if (tooltip && tooltip.contains(e.relatedTarget as Node | null)) return;
    hideTooltip();
  });

  // ── Click tooltip → send to SW ────────────────────────────
  document.addEventListener('click', (e: MouseEvent) => {
    if (!tooltip || !tooltip.contains(e.target as Node)) return;

    e.preventDefault();
    e.stopPropagation();

    const url = activeAnchor?.href;
    if (!url) return;

    try {
      chrome.runtime.sendMessage({
        type: 'START_DOWNLOAD',
        payload: {
          url,
          filename: activeAnchor?.download || undefined,
          referrer: location.href,
        },
      }).catch(() => {});
    } catch {
      // ignore
    }

    // Visual feedback
    tooltip.innerHTML = '✓ Added to All-Downloader';
    tooltip.style.color = '#ffb703';
    setTimeout(() => hideTooltip(), 1200);
  });

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
