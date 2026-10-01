// ============================================================
//  Unit Tests — RightClickDetector (Save As intent detection)
// ============================================================
import { describe, test, expect, beforeEach } from 'vitest';
import {
  RightClickDetector,
  urlsMatch,
  stripQuery,
  cleanUrl,
  getFilename,
  getBaseStem,
  getFileExt,
} from '../../src/background/services/right-click-detector.ts';

describe('RightClickDetector URL matching helpers', () => {
  test('cleanUrl strips hash fragment', () => {
    expect(cleanUrl('https://example.com/image.jpg#preview')).toBe('https://example.com/image.jpg');
    expect(cleanUrl('https://example.com/image.jpg')).toBe('https://example.com/image.jpg');
  });

  test('stripQuery strips query parameters and hash', () => {
    expect(stripQuery('https://example.com/image.jpg?size=large&v=2#test')).toBe('https://example.com/image.jpg');
    expect(stripQuery('https://example.com/image.jpg')).toBe('https://example.com/image.jpg');
  });

  test('getFilename extracts file name from URL', () => {
    expect(getFilename('https://w.wallhaven.cc/full/rq/wallhaven-rqee3j.jpg')).toBe('wallhaven-rqee3j.jpg');
    expect(getFilename('https://example.com/path/encoded%20name.png?v=1')).toBe('encoded name.png');
    expect(getFilename('https://example.com/images/photo.webp?auto=compress&cs=tinysrgb')).toBe('photo.webp');
  });

  test('getBaseStem and getFileExt extract stem and extension cleanly', () => {
    expect(getFileExt('wallpaper.jpg')).toBe('jpg');
    expect(getFileExt('archive.tar.gz')).toBe('gz');
    expect(getBaseStem('photo-800x600.jpg')).toBe('photo');
    expect(getBaseStem('avatar_thumb.png')).toBe('avatar');
    expect(getBaseStem('picture_preview.webp')).toBe('picture');
  });

  test('urlsMatch matches identical and variant URLs', () => {
    // Exact match
    expect(urlsMatch('https://site.com/img.jpg', 'https://site.com/img.jpg')).toBe(true);

    // Hash differences
    expect(urlsMatch('https://site.com/img.jpg', 'https://site.com/img.jpg#zoom')).toBe(true);

    // Query parameters difference (e.g. CDN parameters)
    expect(urlsMatch('https://site.com/img.jpg?token=abc', 'https://site.com/img.jpg')).toBe(true);

    // Filename match on same origin
    expect(urlsMatch(
      'https://w.wallhaven.cc/full/rq/wallhaven-rqee3j.jpg',
      'https://w.wallhaven.cc/small/rq/wallhaven-rqee3j.jpg'
    )).toBe(true);

    // Base stem match on same origin (responsive thumbnail vs full)
    expect(urlsMatch(
      'https://site.com/photos/beach_large.jpg',
      'https://site.com/photos/beach_thumb.jpg'
    )).toBe(true);

    // Cross-origin filename match for modern and future formats (.jxl, .parquet, .blend, .tar.zst)
    expect(urlsMatch(
      'https://cdn.example.com/assets/artwork-full.jxl',
      'https://example.com/artwork-full.jxl'
    )).toBe(true);

    expect(urlsMatch(
      'https://data.example.com/dataset_2026.parquet',
      'https://example.com/dataset_2026.parquet'
    )).toBe(true);

    expect(urlsMatch(
      'https://assets.3d.org/scene_final.blend',
      'https://studio.com/scene_final.blend'
    )).toBe(true);

    // Completely different URLs
    expect(urlsMatch('https://site.com/file1.zip', 'https://other.com/file2.zip')).toBe(false);
  });
});

describe('RightClickDetector Save As bypass lifecycle', () => {
  let detector: RightClickDetector;

  beforeEach(() => {
    detector = new RightClickDetector(60000);
  });

  test('bypasses download when user right-clicked image and clicked Save image as...', () => {
    const imageUrl = 'https://w.wallhaven.cc/full/rq/wallhaven-rqee3j.jpg';
    const pageUrl = 'https://wallhaven.cc/w/rqee3j';

    detector.record([imageUrl], pageUrl);

    const isBypass = detector.isRightClickDownload({
      url: imageUrl,
      finalUrl: imageUrl,
      referrer: pageUrl,
      filename: 'wallhaven-rqee3j.jpg',
    });

    expect(isBypass).toBe(true);
    // Consumed: should not match a second time
    expect(detector.isRightClickDownload({ url: imageUrl })).toBe(false);
  });

  test('persists record when user takes 2-3 seconds to choose Save image as from menu', () => {
    const imageUrl = 'https://site.com/high-res-photo.jpg';
    const pageUrl = 'https://site.com/gallery';

    const originalNow = Date.now;
    try {
      let currentTime = 1000;
      Date.now = () => currentTime;

      // User right clicks
      detector.record([imageUrl], pageUrl);

      // User spends 2500ms moving mouse and reading menu
      currentTime = 3500;

      // User clicks Save image as...
      const isBypass = detector.isRightClickDownload({
        url: imageUrl,
        referrer: pageUrl,
        filename: 'high-res-photo.jpg',
      });

      expect(isBypass).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });

  test('bypasses download when user opened image in new tab and clicked Save image as...', () => {
    const imageUrl = 'https://w.wallhaven.cc/full/rq/wallhaven-rqee3j.jpg';

    // In a standalone tab, pageUrl is the image URL itself
    detector.record([imageUrl], imageUrl);

    const isBypass = detector.isRightClickDownload({
      url: imageUrl,
      filename: 'wallhaven-rqee3j.jpg',
    });

    expect(isBypass).toBe(true);
  });

  test('bypasses download when user right-clicked link and clicked Save link as...', () => {
    const linkUrl = 'https://example.com/downloads/manual.pdf';
    const pageUrl = 'https://example.com/docs';

    detector.record([linkUrl], pageUrl);

    const isBypass = detector.isRightClickDownload({
      url: linkUrl,
      referrer: pageUrl,
      filename: 'manual.pdf',
    });

    expect(isBypass).toBe(true);
  });

  test('does NOT bypass standard download when no right-click occurred', () => {
    const isBypass = detector.isRightClickDownload({
      url: 'https://example.com/release-v1.0.zip',
      filename: 'release-v1.0.zip',
    });

    expect(isBypass).toBe(false);
  });

  test('dismisses record when user explicitly cancels via Escape', () => {
    const imageUrl = 'https://site.com/pic.png';
    const pageUrl = 'https://site.com/gallery';

    detector.record([imageUrl], pageUrl);
    detector.dismiss(pageUrl);

    const isBypass = detector.isRightClickDownload({ url: imageUrl });
    expect(isBypass).toBe(false);
  });

  test('expires old right-click records after TTL', () => {
    const originalNow = Date.now;
    try {
      let currentTime = 10000;
      Date.now = () => currentTime;

      detector.record(['https://site.com/old-image.jpg'], 'https://site.com');

      // 65 seconds later (> 60s TTL)
      currentTime += 65000;

      const isBypass = detector.isRightClickDownload({ url: 'https://site.com/old-image.jpg' });
      expect(isBypass).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  test('consume() clears record when handled via All Downloader context menu option', () => {
    const imageUrl = 'https://site.com/artwork.png';
    detector.record([imageUrl], 'https://site.com');

    // User selected "Download with All Downloader" from context menu
    detector.consume(imageUrl);

    // Any subsequent native check returns false
    expect(detector.isRightClickDownload({ url: imageUrl })).toBe(false);
  });
});
