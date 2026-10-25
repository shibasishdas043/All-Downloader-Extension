// ============================================================
//  All-Downloader — Media Stream Registry Unit Tests
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaStreamRegistry } from '../../src/background/services/media-stream-registry.js';

describe('MediaStreamRegistry — Dynamic Video & Stream Sniffing', () => {
  let registry: MediaStreamRegistry;
  let setBadgeTextMock: any;
  let setBadgeBackgroundColorMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    setBadgeTextMock = vi.fn();
    setBadgeBackgroundColorMock = vi.fn();

    // Mock chrome APIs
    (globalThis as any).chrome = {
      action: {
        setBadgeText: setBadgeTextMock,
        setBadgeBackgroundColor: setBadgeBackgroundColorMock,
      },
      tabs: {
        onRemoved: { addListener: vi.fn() },
        onUpdated: { addListener: vi.fn() },
      },
      webRequest: {
        onHeadersReceived: { addListener: vi.fn() },
      },
    };

    registry = new MediaStreamRegistry();
  });

  it('registers detected media streams and updates tab action badge', () => {
    registry.registerMedia(101, {
      url: 'https://example.com/stream/master.m3u8',
      title: 'Course Lecture 1',
      filename: 'lecture1.mp4',
      type: 'video',
      ext: 'mp4',
      timestamp: Date.now(),
      isStreamManifest: true,
      resolution: 'Adaptive HD',
    });

    const streams = registry.getMediaForTab(101);
    expect(streams).toHaveLength(1);
    expect(streams[0].url).toBe('https://example.com/stream/master.m3u8');
    expect(streams[0].isStreamManifest).toBe(true);

    expect(setBadgeTextMock).toHaveBeenCalledWith({ tabId: 101, text: '1' });
    expect(setBadgeBackgroundColorMock).toHaveBeenCalledWith({ tabId: 101, color: '#2563eb' });
  });

  it('deduplicates streams with the same URL and enriches existing metadata', () => {
    registry.registerMedia(101, {
      url: 'https://example.com/video.mp4',
      title: 'Video',
      filename: 'video.mp4',
      type: 'video',
      ext: 'mp4',
      timestamp: 1000,
    });

    // Second event with enriched content length
    registry.registerMedia(101, {
      url: 'https://example.com/video.mp4',
      title: 'Video Full',
      filename: 'video.mp4',
      type: 'video',
      ext: 'mp4',
      contentLength: 45000000,
      resolution: '1080p',
      timestamp: 2000,
    });

    const streams = registry.getMediaForTab(101);
    expect(streams).toHaveLength(1);
    expect(streams[0].contentLength).toBe(45000000);
    expect(streams[0].resolution).toBe('1080p');
  });

  it('returns the most relevant or latest stream for hover FAB and quick download', () => {
    registry.registerMedia(202, {
      url: 'https://cdn.test/audio.mp3',
      title: 'Background Music',
      filename: 'audio.mp3',
      type: 'audio',
      ext: 'mp3',
      timestamp: 1000,
    });

    registry.registerMedia(202, {
      url: 'https://cdn.test/video.mp4',
      title: 'Main Presentation',
      filename: 'video.mp4',
      type: 'video',
      ext: 'mp4',
      timestamp: 2000,
    });

    const latest = registry.getLatestStreamForTab(202);
    expect(latest).not.toBeNull();
    expect(latest?.url).toBe('https://cdn.test/video.mp4');
    expect(latest?.type).toBe('video');
  });

  it('bounds maximum streams per tab to 150 items to keep memory constant O(1)', () => {
    for (let i = 0; i < 160; i++) {
      registry.registerMedia(303, {
        url: `https://example.com/clip_${i}.mp4`,
        title: `Clip ${i}`,
        filename: `clip_${i}.mp4`,
        type: 'video',
        ext: 'mp4',
        timestamp: Date.now() + i,
      });
    }

    const streams = registry.getMediaForTab(303);
    expect(streams.length).toBe(150);
  });

  it('clears tab stream memory and resets badge when tab is closed or navigated', () => {
    registry.registerMedia(404, {
      url: 'https://example.com/video.mp4',
      title: 'Video',
      filename: 'video.mp4',
      type: 'video',
      ext: 'mp4',
      timestamp: Date.now(),
    });

    expect(registry.getMediaForTab(404)).toHaveLength(1);

    registry.clearTab(404);
    expect(registry.getMediaForTab(404)).toHaveLength(0);
    expect(setBadgeTextMock).toHaveBeenCalledWith({ tabId: 404, text: '' });
  });
});
