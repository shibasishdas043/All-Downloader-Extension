// ============================================================
//  All-Downloader — Floating Action Button (Hover Grab UI)
//  Injects a zero-conflict Shadow DOM component for one-click
//  media downloading and URL copying directly from the page.
// ============================================================

export interface MediaInfo {
  url: string;
  type: 'video' | 'image' | 'audio' | 'canvas';
  ext: string;
  resolution?: string;
  filename?: string;
  isStream?: boolean;
}

export class HoverFAB {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private pill: HTMLElement;
  private dlBtn: HTMLButtonElement;
  private copyBtn: HTMLButtonElement;
  private badge: HTMLElement;
  private currentMedia: MediaInfo | null = null;
  private isPointerOverPill = false;
  private isVisible = false;

  constructor() {
    // Isolated container host attached to <html>
    this.host = document.createElement('div');
    this.host.id = '__adl-fab-host';
    this.host.style.cssText = `
      all: initial !important;
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 0 !important;
      height: 0 !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      overflow: visible !important;
    `;

    // Closed shadow DOM to ensure no page styles bleed in or out
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    // Stylesheet inside shadow root
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }
      .adl-fab-pill {
        position: fixed;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 8px;
        background: rgba(15, 23, 42, 0.94);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 9999px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.45), 0 8px 10px -6px rgba(0, 0, 0, 0.35);
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1;
        pointer-events: auto;
        opacity: 0;
        transform: scale(0.92) translateY(-4px);
        transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 2147483647;
        user-select: none;
        cursor: default;
      }

      .adl-fab-pill.visible {
        opacity: 1;
        transform: scale(1) translateY(0);
      }

      .adl-badge {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        color: #93c5fd;
        background: rgba(59, 130, 246, 0.22);
        padding: 3px 6px;
        border-radius: 4px;
        letter-spacing: 0.5px;
        white-space: nowrap;
      }

      .adl-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: none;
        outline: none;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        border-radius: 9999px;
        transition: background 0.15s ease, transform 0.1s ease, color 0.15s ease;
      }

      .adl-btn:active {
        transform: scale(0.96);
      }

      .adl-btn-dl {
        background: #2563eb;
        color: #ffffff;
        padding: 5px 10px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
      }

      .adl-btn-dl:hover {
        background: #1d4ed8;
      }

      .adl-btn-dl.success {
        background: #10b981;
      }

      .adl-btn-copy {
        background: transparent;
        color: #94a3b8;
        padding: 5px 8px;
      }

      .adl-btn-copy:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #f1f5f9;
      }

      .adl-btn-copy.copied {
        color: #34d399;
      }

      svg {
        display: block;
        flex-shrink: 0;
      }
    `;

    // FAB Pill HTML
    this.pill = document.createElement('div');
    this.pill.className = 'adl-fab-pill';

    this.badge = document.createElement('span');
    this.badge.className = 'adl-badge';
    this.badge.textContent = 'MEDIA';

    this.dlBtn = document.createElement('button');
    this.dlBtn.className = 'adl-btn adl-btn-dl';
    this.dlBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span class="adl-dl-label">Download</span>
    `;

    this.copyBtn = document.createElement('button');
    this.copyBtn.className = 'adl-btn adl-btn-copy';
    this.copyBtn.title = 'Copy Direct Link';
    this.copyBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;

    this.pill.appendChild(this.badge);
    this.pill.appendChild(this.dlBtn);
    this.pill.appendChild(this.copyBtn);

    this.shadow.appendChild(style);
    this.shadow.appendChild(this.pill);

    this.attachEvents();
    this.ensureHostMounted();
  }

  private ensureHostMounted(): void {
    const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
    const targetParent = fsEl || document.documentElement || document.body;

    if (targetParent && this.host.parentElement !== targetParent) {
      targetParent.appendChild(this.host);
    }
  }

  private attachEvents(): void {
    // Keep visible while pointer is over the pill itself
    this.pill.addEventListener('pointerenter', () => {
      this.isPointerOverPill = true;
    });

    this.pill.addEventListener('pointerleave', () => {
      this.isPointerOverPill = false;
      this.hide();
    });

    // Listen for fullscreen transitions to keep FAB visible
    document.addEventListener('fullscreenchange', () => {
      this.ensureHostMounted();
    });
    document.addEventListener('webkitfullscreenchange', () => {
      this.ensureHostMounted();
    });

    // Download action
    this.dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!this.currentMedia) return;

      const label = this.dlBtn.querySelector('.adl-dl-label');
      if (label) label.textContent = 'Started!';
      this.dlBtn.classList.add('success');

      try {
        if (this.currentMedia.isStream || this.currentMedia.url.includes('.m3u8') || this.currentMedia.url.includes('.mpd')) {
          chrome.runtime.sendMessage({
            type: 'HLS_PLAYLIST_DETECTED',
            payload: {
              playlistUrl: this.currentMedia.url,
              pageUrl: window.location.href,
              pageTitle: document.title,
              autoDownload: true,
            },
          }).catch(() => {});
        } else {
          chrome.runtime.sendMessage({
            type: 'START_DOWNLOAD',
            payload: {
              url: this.currentMedia.url,
              referrer: window.location.href,
              filename: this.currentMedia.filename,
              pageTitle: document.title,
            },
          }).catch(() => {});
        }
      } catch {
        // ignore
      }

      setTimeout(() => {
        if (label) label.textContent = 'Download';
        this.dlBtn.classList.remove('success');
        this.hide();
      }, 1200);
    });

    // Copy URL action
    this.copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!this.currentMedia) return;

      navigator.clipboard.writeText(this.currentMedia.url).then(() => {
        this.copyBtn.classList.add('copied');
        this.copyBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
        setTimeout(() => {
          this.copyBtn.classList.remove('copied');
          this.copyBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          `;
        }, 1200);
      }).catch(() => {});
    });
  }

  public show(rect: DOMRect, media: MediaInfo): void {
    this.ensureHostMounted();
    this.currentMedia = media;

    // Badge text
    const badgeText = media.resolution
      ? media.resolution
      : media.ext
      ? media.ext.toUpperCase()
      : media.type.toUpperCase();
    this.badge.textContent = badgeText;

    // Position FAB pill near top-right corner of the target element inside viewport
    const pillWidth = 200;
    const pillHeight = 36;
    const pad = 10;

    let top = rect.top + pad;
    let left = rect.right - pillWidth - pad;

    // Boundary constraints: ensure FAB stays visible in the viewport
    if (top < pad) top = pad;
    if (top > window.innerHeight - pillHeight - pad) {
      top = window.innerHeight - pillHeight - pad;
    }
    if (left < pad) left = pad;
    if (left > window.innerWidth - pillWidth - pad) {
      left = window.innerWidth - pillWidth - pad;
    }

    this.pill.style.top = `${Math.round(top)}px`;
    this.pill.style.left = `${Math.round(left)}px`;
    this.pill.classList.add('visible');
    this.isVisible = true;
  }

  public hide(): void {
    if (this.isPointerOverPill) return;
    this.pill.classList.remove('visible');
    this.isVisible = false;
  }

  public isHovered(): boolean {
    return this.isPointerOverPill;
  }

  public getVisible(): boolean {
    return this.isVisible;
  }

  public destroy(): void {
    this.host.remove();
  }
}
