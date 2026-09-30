// ============================================================
//  All-Downloader — Content Script (Link Interceptor - TypeScript)
//  Injects "Download with All-Downloader" button on page links.
//  Runs on every page at document_idle.
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
    document.body.appendChild(el);
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

  // ── Detect downloadable link ──────────────────────────────
  const DOWNLOAD_EXTS = /\.(zip|rar|7z|tar|gz|bz2|xz|iso|exe|msi|dmg|apk|deb|rpm|pkg|mp4|mkv|avi|mov|wmv|flv|webm|mp3|aac|flac|wav|ogg|pdf|doc|docx|xls|xlsx|ppt|pptx)(\?.*)?$/i;

  function isDownloadLink(href: string | null): boolean {
    if (!href) return false;
    try {
      const url = new URL(href, location.href);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        DOWNLOAD_EXTS.test(url.pathname)
      );
    } catch { return false; }
  }

  // ── Delegate mouseover to links ───────────────────────────
  document.addEventListener('mouseover', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const a = target?.closest('a[href]') as HTMLAnchorElement | null;
    if (!a) return;

    const href = a.getAttribute('href');
    if (!isDownloadLink(href)) return;

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

    chrome.runtime.sendMessage({
      type: 'START_DOWNLOAD',
      payload: {
        url,
        filename: activeAnchor?.download || undefined,
        referrer: location.href,
      },
    });

    // Visual feedback
    tooltip.innerHTML = '✓ Added to All-Downloader';
    tooltip.style.color = '#ffb703';
    setTimeout(() => hideTooltip(), 1200);
  });
})();
