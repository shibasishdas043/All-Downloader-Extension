// ============================================================
//  All-Downloader — Main-World Stream & Media Sniffer
//  Runs directly in the page's execution context (world: MAIN)
//  to intercept dynamic video streams, HLS manifests, DASH manifests,
//  and custom media player network calls (Vimeo, Twitter, Reddit, etc.)
// ============================================================

(function () {
  'use strict';

  if ((window as any).__adlMainSnifferInjected) return;
  (window as any).__adlMainSnifferInjected = true;

  const detectedUrls = new Set<string>();

  function dispatchDetectedMedia(url: string, origin: string) {
    if (!url || typeof url !== 'string') return;
    if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('javascript:')) return;

    let absoluteUrl = url;
    try {
      absoluteUrl = new URL(url, window.location.href).href;
    } catch {
      return;
    }

    if (detectedUrls.has(absoluteUrl)) return;
    detectedUrls.add(absoluteUrl);

    try {
      window.postMessage(
        {
          source: 'ALL_DOWNLOADER_SNIFFER',
          message: {
            type: 'HLS_PLAYLIST_DETECTED',
            payload: {
              playlistUrl: absoluteUrl,
              pageUrl: window.location.href,
              pageTitle: document.title,
              origin,
            },
          },
        },
        '*'
      );
    } catch {
      // ignore
    }
  }

  function isMediaStreamUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    const clean = lower.split('?')[0];
    return (
      clean.endsWith('.m3u8') ||
      clean.endsWith('.mpd') ||
      clean.endsWith('.mp4') ||
      clean.endsWith('.webm') ||
      clean.endsWith('.m4v') ||
      clean.endsWith('.mkv') ||
      clean.endsWith('.avi') ||
      clean.endsWith('.mov') ||
      clean.endsWith('.flv') ||
      clean.endsWith('.ts') ||
      clean.includes('.m3u8') ||
      clean.includes('.mpd') ||
      clean.includes('.f4m') ||
      clean.includes('.ism') ||
      lower.includes('format=m3u8') ||
      lower.includes('format=hls') ||
      lower.includes('type=m3u8') ||
      lower.includes('manifest=mpd')
    );
  }

  // 1. Intercept window.fetch
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function (...args: any[]) {
      const input = args[0];
      let url = '';
      if (typeof input === 'string') {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else if (input && typeof input === 'object' && 'url' in input) {
        url = (input as Request).url;
      }

      if (url && isMediaStreamUrl(url)) {
        dispatchDetectedMedia(url, 'fetch');
      }

      const response = await Reflect.apply(originalFetch, this, args);

      try {
        const contentType = response.headers?.get('content-type') || '';
        if (
          contentType.includes('application/vnd.apple.mpegurl') ||
          contentType.includes('application/x-mpegurl') ||
          contentType.includes('application/dash+xml') ||
          contentType.startsWith('video/')
        ) {
          dispatchDetectedMedia(response.url || url, 'fetch-header');
        }
      } catch {}

      return response;
    };
  }

  // 2. Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: any[]) {
    const url = args[1];
    if (typeof url === 'string' && isMediaStreamUrl(url)) {
      dispatchDetectedMedia(url, 'xhr');
    }
    (this as any).__adlUrl = url;
    return Reflect.apply(originalOpen, this, args as any);
  };

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: any[]) {
    this.addEventListener(
      'load',
      () => {
        try {
          const contentType = this.getResponseHeader('content-type') || '';
          if (
            contentType.includes('application/vnd.apple.mpegurl') ||
            contentType.includes('application/x-mpegurl') ||
            contentType.includes('application/dash+xml') ||
            contentType.startsWith('video/')
          ) {
            const url = (this as any).__adlUrl || this.responseURL;
            if (url) dispatchDetectedMedia(url, 'xhr-header');
          }
        } catch {}
      },
      { once: true }
    );

    return Reflect.apply(originalSend, this, args);
  };

  // 3. Intercept HTMLMediaElement Prototype (src setter, play, load)
  try {
    const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (originalSrcDescriptor && originalSrcDescriptor.set) {
      const originalSet = originalSrcDescriptor.set;
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        set(value: string) {
          if (value && typeof value === 'string' && isMediaStreamUrl(value)) {
            dispatchDetectedMedia(value, 'media-src');
          }
          return originalSet.call(this, value);
        },
        get: originalSrcDescriptor.get,
        configurable: true,
        enumerable: true,
      });
    }

    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const src = this.currentSrc || this.src;
      if (src && typeof src === 'string' && isMediaStreamUrl(src)) {
        dispatchDetectedMedia(src, 'media-play');
      }
      return originalPlay.call(this);
    };
  } catch {}

  // ══════════════════════════════════════════════════════════════
  //  4. Universal Right-Click & Copy Protection Unblocker (Main World)
  //  Unconditionally unblocks mouse right-clicks, native context menu,
  //  text selection, and copying across all restricted websites.
  // ══════════════════════════════════════════════════════════════
  try {
    let unblockRightClickActive = true;

    // Synchronize settings with isolated content script
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.source !== 'ALL_DOWNLOADER_RIGHT_CLICK_CONFIG') return;
      if (typeof event.data?.unblockRightClick === 'boolean') {
        unblockRightClickActive = event.data.unblockRightClick;
      }
    });

    // Track right-click interaction window to suppress modal alert dialogs
    let isRightClicking = false;
    let rightClickTimer: any = null;

    function markRightClickActive() {
      isRightClicking = true;
      clearTimeout(rightClickTimer);
      rightClickTimer = setTimeout(() => {
        isRightClicking = false;
      }, 400);
    }

    window.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 2) markRightClickActive();
    }, true);

    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (e.button === 2) markRightClickActive();
    }, true);

    window.addEventListener('contextmenu', () => {
      markRightClickActive();
    }, true);

    // Suppress modal alerts triggered during right-click events
    const originalAlert = window.alert;
    if (typeof originalAlert === 'function') {
      window.alert = function (...args: any[]) {
        if (unblockRightClickActive && isRightClicking) {
          return;
        }
        return Reflect.apply(originalAlert, this, args);
      };
    }

    // 1. Intercept Event.prototype.preventDefault to prevent cancelling right-clicks
    const originalPreventDefault = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function (this: Event) {
      if (unblockRightClickActive && this && typeof this.type === 'string') {
        const type = this.type;
        if (type === 'contextmenu') {
          return; // Unconditionally allow browser native context menu
        }
        if (
          (type === 'mousedown' || type === 'mouseup' || type === 'pointerdown' || type === 'pointerup') &&
          (this as MouseEvent).button === 2
        ) {
          return; // Do not allow canceling right mouse clicks
        }
        if (type === 'selectstart' || type === 'copy' || type === 'cut') {
          return; // Do not allow blocking text selection or copying
        }
      }
      return originalPreventDefault.call(this);
    };

    // 2. Intercept Event.prototype.returnValue (legacy preventDefault)
    const rvDesc = Object.getOwnPropertyDescriptor(Event.prototype, 'returnValue');
    if (rvDesc && rvDesc.set) {
      const originalSetReturnValue = rvDesc.set;
      Object.defineProperty(Event.prototype, 'returnValue', {
        get: rvDesc.get,
        set(this: Event, val: boolean) {
          if (unblockRightClickActive && this && typeof this.type === 'string' && val === false) {
            const type = this.type;
            if (
              type === 'contextmenu' ||
              ((type === 'mousedown' || type === 'mouseup' || type === 'pointerdown' || type === 'pointerup') && (this as MouseEvent).button === 2) ||
              type === 'selectstart' ||
              type === 'copy' ||
              type === 'cut'
            ) {
              return true; // Ignore cancellation
            }
          }
          return originalSetReturnValue.call(this, val);
        },
        configurable: true,
        enumerable: true,
      });
    }

    // 3. Intercept Event.prototype.stopPropagation and stopImmediatePropagation for contextmenu
    const originalStopPropagation = Event.prototype.stopPropagation;
    Event.prototype.stopPropagation = function (this: Event) {
      if (unblockRightClickActive && this && typeof this.type === 'string' && this.type === 'contextmenu') {
        return; // Do not let website scripts suppress propagation to native context menu
      }
      return originalStopPropagation.call(this);
    };

    const originalStopImmediatePropagation = Event.prototype.stopImmediatePropagation;
    Event.prototype.stopImmediatePropagation = function (this: Event) {
      if (unblockRightClickActive && this && typeof this.type === 'string' && this.type === 'contextmenu') {
        return;
      }
      return originalStopImmediatePropagation.call(this);
    };

    // 4. Intercept property setters for oncontextmenu, onselectstart, ondragstart, oncopy, oncut
    // on HTMLElement.prototype, Document.prototype, and Window.prototype
    const protectedProps = ['oncontextmenu', 'onselectstart', 'ondragstart', 'oncopy', 'oncut'];
    const protoTargets: any[] = [];
    if (typeof HTMLElement !== 'undefined' && HTMLElement.prototype) protoTargets.push(HTMLElement.prototype);
    if (typeof Document !== 'undefined' && Document.prototype) protoTargets.push(Document.prototype);
    if (typeof Window !== 'undefined' && Window.prototype) protoTargets.push(Window.prototype);

    for (const proto of protoTargets) {
      for (const prop of protectedProps) {
        try {
          const desc = Object.getOwnPropertyDescriptor(proto, prop);

          Object.defineProperty(proto, prop, {
            get(this: any) {
              if (desc && desc.get) {
                return desc.get.call(this) ?? this['__adl_raw_' + prop];
              }
              return this['__adl_raw_' + prop] ?? null;
            },
            set(this: any, fn: any) {
              this['__adl_raw_' + prop] = fn;

              if (!unblockRightClickActive || typeof fn !== 'function') {
                if (desc && desc.set) {
                  desc.set.call(this, fn);
                } else {
                  this['__adl_handler_' + prop] = fn;
                }
                return;
              }

              // Wrap handler so it cannot return false to cancel the event
              const sanitizedHandler = function (this: any, ...args: any[]) {
                const result = fn.apply(this, args);
                const ev = args[0] || (typeof window !== 'undefined' ? (window as any).event : null);
                if (result === false && ev && (ev.type === 'contextmenu' || ev.type === 'selectstart' || ev.type === 'copy')) {
                  return true; // Neutralize return false
                }
                return result;
              };

              if (desc && desc.set) {
                desc.set.call(this, sanitizedHandler);
              } else {
                this['__adl_handler_' + prop] = sanitizedHandler;
              }
            },
            configurable: true,
            enumerable: true,
          });
        } catch {}
      }
    }
  } catch {}
})();
