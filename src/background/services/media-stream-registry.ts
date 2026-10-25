// ============================================================
//  All-Downloader — Dynamic Media & Stream Sniffer Registry
//  Passively intercepts media network responses across all tabs
//  via chrome.webRequest, stores live streams, and updates badges.
// ============================================================

import type { SniffedMediaItem } from '../../shared/types.js';

export interface CapturedStreamItem extends SniffedMediaItem {
  tabId?: number;
  timestamp: number;
  contentLength?: number;
  mimeType?: string;
  isStreamManifest?: boolean;
}

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v',
  'ts', '3gp', 'ogv', 'm3u8', 'mpd', 'f4m', 'ism', 'vob', 'divx'
]);

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma', 'opus',
  'alac', 'aiff', 'mid', 'midi'
]);

export class MediaStreamRegistry {
  private tabMedia = new Map<number, Map<string, CapturedStreamItem>>();
  private isListening = false;

  constructor() {
    this.setupTabLifecycleListeners();
  }

  /**
   * Initializes non-blocking webRequest listener for media interception.
   */
  public initWebRequestSniffer(): void {
    if (this.isListening || typeof chrome === 'undefined' || !chrome.webRequest) return;

    try {
      chrome.webRequest.onHeadersReceived.addListener(
        (details: any) => {
          this.handleHeadersReceived(details);
        },
        { urls: ['<all_urls>'] },
        ['responseHeaders']
      );
      this.isListening = true;
    } catch (err) {
      console.warn('[ADL MediaRegistry] webRequest sniffer initialization notice:', err);
    }
  }

  private handleHeadersReceived(details: any): void {
    if (!details || details.tabId < 0 || !details.url) return;
    if (details.url.startsWith('chrome-extension://') || details.url.startsWith('blob:') || details.url.startsWith('data:')) return;

    let contentType = '';
    let contentLength = 0;
    let contentDisposition = '';

    if (details.responseHeaders) {
      for (const h of details.responseHeaders) {
        const name = (h.name || '').toLowerCase();
        if (name === 'content-type') contentType = (h.value || '').toLowerCase();
        else if (name === 'content-length') contentLength = parseInt(h.value || '0', 10) || 0;
        else if (name === 'content-disposition') contentDisposition = h.value || '';
      }
    }

    const cleanUrl = details.url.split('?')[0].toLowerCase();
    const isM3U8 = cleanUrl.endsWith('.m3u8') || details.url.toLowerCase().includes('.m3u8');
    const isMPD = cleanUrl.endsWith('.mpd') || details.url.toLowerCase().includes('.mpd');
    const isHlsMime = contentType.includes('application/vnd.apple.mpegurl') || contentType.includes('application/x-mpegurl');
    const isDashMime = contentType.includes('application/dash+xml');
    const isVideoMime = contentType.startsWith('video/');
    const isAudioMime = contentType.startsWith('audio/');

    // Check extension
    const extMatch = cleanUrl.match(/\.([a-z0-9]{2,5})$/);
    const ext = extMatch ? extMatch[1] : '';
    const isVideoExt = VIDEO_EXTENSIONS.has(ext);
    const isAudioExt = AUDIO_EXTENSIONS.has(ext);

    // Skip tiny tracking beacons or images mislabeled
    if (contentLength > 0 && contentLength < 32768 && !isM3U8 && !isMPD) {
      return;
    }

    if (isM3U8 || isMPD || isHlsMime || isDashMime || isVideoMime || isVideoExt || isAudioMime || isAudioExt) {
      const type: 'video' | 'audio' = (isAudioMime || isAudioExt) && !isVideoMime && !isVideoExt ? 'audio' : 'video';
      const isStream = isM3U8 || isMPD || isHlsMime || isDashMime;

      let filename = '';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
        if (match && match[1]) filename = decodeURIComponent(match[1]);
      }
      if (!filename) {
        filename = cleanUrl.split('/').pop() || (isStream ? 'stream.mp4' : 'media');
        if (isStream && !filename.endsWith('.mp4')) {
          filename = filename.replace(/\.(m3u8|mpd)$/i, '') + '.mp4';
        }
      }

      this.registerMedia(details.tabId, {
        url: details.url,
        title: filename,
        filename,
        type,
        ext: isStream ? 'mp4' : (ext || (type === 'video' ? 'mp4' : 'mp3')),
        contentLength: contentLength || undefined,
        size: contentLength || null,
        mimeType: contentType || undefined,
        origin: isStream ? 'stream-sniffer' : 'web-request',
        timestamp: Date.now(),
        isStreamManifest: isStream,
        resolution: isStream ? 'Adaptive HD' : undefined,
      });
    }
  }

  /**
   * Registers a discovered media or stream item under a specific tab.
   */
  public registerMedia(tabId: number, item: CapturedStreamItem): void {
    if (tabId < 0 || !item.url) return;

    if (!this.tabMedia.has(tabId)) {
      this.tabMedia.set(tabId, new Map());
    }

    const tabMap = this.tabMedia.get(tabId)!;
    const existing = tabMap.get(item.url);

    // If already exists, enrich metadata without wiping
    if (existing) {
      if (!existing.contentLength && item.contentLength) existing.contentLength = item.contentLength;
      if (!existing.resolution && item.resolution) existing.resolution = item.resolution;
      if (!existing.mimeType && item.mimeType) existing.mimeType = item.mimeType;
      return;
    }

    // Limit maximum tracked streams per tab to 150 to keep memory O(1)
    if (tabMap.size >= 150) {
      const oldestKey = tabMap.keys().next().value;
      if (oldestKey) tabMap.delete(oldestKey);
    }

    tabMap.set(item.url, item);
    this.updateTabBadge(tabId);
  }

  /**
   * Returns all media items captured on a tab.
   */
  public getMediaForTab(tabId: number): CapturedStreamItem[] {
    const map = this.tabMedia.get(tabId);
    if (!map) return [];
    return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Returns the most recent captured video or stream on a tab.
   */
  public getLatestStreamForTab(tabId: number): CapturedStreamItem | null {
    const items = this.getMediaForTab(tabId);
    return items.find((i) => i.isStreamManifest || i.type === 'video') || items[0] || null;
  }

  /**
   * Cleans up tab memory when closed or navigated.
   */
  public clearTab(tabId: number): void {
    this.tabMedia.delete(tabId);
    this.updateTabBadge(tabId);
  }

  private updateTabBadge(tabId: number): void {
    if (typeof chrome === 'undefined' || !chrome.action?.setBadgeText) return;

    const count = this.tabMedia.get(tabId)?.size || 0;
    const text = count > 0 ? (count > 99 ? '99+' : String(count)) : '';

    try {
      chrome.action.setBadgeText({ tabId, text });
      if (count > 0) {
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' });
        if ((chrome.action as any).setBadgeTextColor) {
          (chrome.action as any).setBadgeTextColor({ tabId, color: '#ffffff' });
        }
      }
    } catch {
      // Tab might have closed
    }
  }

  private setupTabLifecycleListeners(): void {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;

    chrome.tabs.onRemoved?.addListener((tabId) => {
      this.clearTab(tabId);
    });

    chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'loading' && changeInfo.url) {
        // Full page reload or URL change: reset media for this tab
        this.clearTab(tabId);
      }
    });
  }
}

export const mediaStreamRegistry = new MediaStreamRegistry();
