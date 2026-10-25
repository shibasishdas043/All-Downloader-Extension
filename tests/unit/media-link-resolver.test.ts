// ============================================================
//  Unit Tests — Universal Media Link & HTML Trap Resolver
// ============================================================
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isHtmlContentType,
  isMediaIntent,
  generateCandidateUrls,
  extractMediaCandidatesFromHtml,
  resolveRealMediaUrl,
} from '../../src/background/services/media-link-resolver.ts';

describe('Universal Media Link & HTML Trap Resolver', () => {
  describe('isHtmlContentType', () => {
    test('identifies text/html and xhtml as HTML traps', () => {
      expect(isHtmlContentType('text/html')).toBe(true);
      expect(isHtmlContentType('text/html; charset=UTF-8')).toBe(true);
      expect(isHtmlContentType('application/xhtml+xml')).toBe(true);
      expect(isHtmlContentType('text/xml')).toBe(true);
    });

    test('identifies binary media and document MIME types as non-HTML', () => {
      expect(isHtmlContentType('video/mp4')).toBe(false);
      expect(isHtmlContentType('video/webm')).toBe(false);
      expect(isHtmlContentType('audio/mpeg')).toBe(false);
      expect(isHtmlContentType('image/jpeg')).toBe(false);
      expect(isHtmlContentType('application/octet-stream')).toBe(false);
      expect(isHtmlContentType('application/pdf')).toBe(false);
      expect(isHtmlContentType(null)).toBe(false);
      expect(isHtmlContentType(undefined)).toBe(false);
    });
  });

  describe('isMediaIntent', () => {
    test('detects media intent by category', () => {
      expect(isMediaIntent('video')).toBe(true);
      expect(isMediaIntent('audio')).toBe(true);
      expect(isMediaIntent('image')).toBe(true);
      expect(isMediaIntent('archive')).toBe(true);
      expect(isMediaIntent('document')).toBe(false);
    });

    test('detects media intent by filename extension', () => {
      expect(isMediaIntent(undefined, 'trailer.mp4')).toBe(true);
      expect(isMediaIntent(undefined, 'song.flac')).toBe(true);
      expect(isMediaIntent(undefined, 'photo.webp')).toBe(true);
      expect(isMediaIntent(undefined, 'package.zip')).toBe(true);
      expect(isMediaIntent(undefined, 'index.htm')).toBe(false);
      expect(isMediaIntent(undefined, 'page.html')).toBe(false);
    });
  });

  describe('generateCandidateUrls', () => {
    test('mutates indirect route prefixes like dh-file to download', () => {
      const candidates = generateCandidateUrls('https://www.desktophut.com/dh-file/1078331');
      expect(candidates).toContain('https://www.desktophut.com/download/1078331');
      expect(candidates).toContain('https://www.desktophut.com/files/1078331');
      expect(candidates).toContain('https://www.desktophut.com/file/1078331');
    });

    test('mutates get-file and dl-file prefixes', () => {
      const candidates = generateCandidateUrls('https://media-server.com/get-file/9842');
      expect(candidates).toContain('https://media-server.com/download/9842');
    });

    test('mutates action=view or mode=view query params', () => {
      const candidates = generateCandidateUrls('https://example.com/asset?id=123&action=view');
      expect(candidates).toContain('https://example.com/asset?id=123&action=download');
    });

    test('mutates preview=1 query param', () => {
      const candidates = generateCandidateUrls('https://example.com/stream?id=456&preview=1');
      expect(candidates).toContain('https://example.com/stream?id=456');
      expect(candidates).toContain('https://example.com/stream?id=456&preview=1&download=1');
    });
  });

  describe('extractMediaCandidatesFromHtml', () => {
    test('extracts direct video and source tags', () => {
      const html = `
        <html>
          <body>
            <video id="player" poster="/img/thumb.webp">
              <source src="/previews/dance-preview.mp4" type="video/mp4">
            </video>
          </body>
        </html>
      `;
      const targets = extractMediaCandidatesFromHtml(html, 'https://example.com/video/page1');
      expect(targets.length).toBeGreaterThanOrEqual(1);
      const found = targets.find((t) => t.url === 'https://example.com/previews/dance-preview.mp4');
      expect(found).toBeDefined();
      expect(found?.type).toBe('video');
      expect(found?.source).toBe('source-tag');
    });

    test('extracts from Schema.org JSON-LD VideoObject', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "VideoObject",
                "name": "Live Wallpaper 4K",
                "contentUrl": "https://cdn.example.com/wallpapers/live-4k.mp4"
              }
            </script>
          </head>
        </html>
      `;
      const targets = extractMediaCandidatesFromHtml(html, 'https://example.com/item/42');
      const found = targets.find((t) => t.url === 'https://cdn.example.com/wallpapers/live-4k.mp4');
      expect(found).toBeDefined();
      expect(found?.source).toBe('json-ld');
      expect(found?.filename).toBe('Live Wallpaper 4K');
    });

    test('extracts from OpenGraph video tags', () => {
      const html = `
        <html>
          <head>
            <meta property="og:video" content="https://cdn.example.com/vod/episode1.mp4">
          </head>
        </html>
      `;
      const targets = extractMediaCandidatesFromHtml(html, 'https://example.com/watch/ep1');
      const found = targets.find((t) => t.url === 'https://cdn.example.com/vod/episode1.mp4');
      expect(found).toBeDefined();
      expect(found?.source).toBe('open-graph');
    });

    test('extracts meta http-equiv refresh redirect target', () => {
      const html = `
        <html>
          <head>
            <meta http-equiv="refresh" content="0; url=https://storage.example.com/downloads/setup.iso">
          </head>
        </html>
      `;
      const targets = extractMediaCandidatesFromHtml(html, 'https://example.com/get/iso');
      expect(targets[0].url).toBe('https://storage.example.com/downloads/setup.iso');
      expect(targets[0].source).toBe('meta-refresh');
      expect(targets[0].score).toBe(100);
    });

    test('extracts download anchors pointing to media files', () => {
      const html = `
        <div>
          <a href="/download/mobile/file?filename=scene.mp4" download="scene.mp4">Mobile Crop</a>
        </div>
      `;
      const targets = extractMediaCandidatesFromHtml(html, 'https://example.com/scene');
      const found = targets.find((t) => t.url === 'https://example.com/download/mobile/file?filename=scene.mp4');
      expect(found).toBeDefined();
      expect(found?.filename).toBe('scene.mp4');
    });
  });

  describe('resolveRealMediaUrl active pipeline', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    test('returns direct media immediately when URL serves valid binary stream', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        return new Response(null, {
          status: 200,
          headers: new Headers({
            'Content-Type': 'video/mp4',
            'Content-Length': '84167254',
            'Accept-Ranges': 'bytes',
          }),
        });
      });

      const res = await resolveRealMediaUrl({
        url: 'https://cdn.example.com/video.mp4',
        expectedCategory: 'video',
        expectedFilename: 'video.mp4',
      });

      expect(res).not.toBeNull();
      expect(res?.mimeType).toBe('video/mp4');
      expect(res?.size).toBe(84167254);
      expect(res?.acceptsRanges).toBe(true);
    });

    test('recovers real media by mutating indirect route (e.g. DesktopHut dh-file -> download)', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : (url as Request).url;

        // /dh-file/1078331 returns HTML webpage (the bug)
        if (u.includes('/dh-file/1078331')) {
          return new Response('<html>Page</html>', {
            status: 200,
            headers: new Headers({
              'Content-Type': 'text/html; charset=UTF-8',
              'Content-Length': '331725',
            }),
          });
        }

        // /download/1078331 returns the 80.27 MB 4K video!
        if (u.includes('/download/1078331')) {
          return new Response(null, {
            status: 200,
            headers: new Headers({
              'Content-Type': 'video/mp4',
              'Content-Length': '84167254',
              'Accept-Ranges': 'bytes',
              'Content-Disposition': 'attachment; filename="wallpaper.mp4"',
            }),
          });
        }

        return new Response(null, { status: 404 });
      });

      const res = await resolveRealMediaUrl({
        url: 'https://www.desktophut.com/dh-file/1078331',
        referrer: 'https://www.desktophut.com/power-dancing-live-wallpaper-y3tn',
        expectedCategory: 'video',
        expectedFilename: 'power-dancing-live-wallpaper.mp4',
      });

      expect(res).not.toBeNull();
      expect(res?.resolvedUrl).toBe('https://www.desktophut.com/download/1078331');
      expect(res?.mimeType).toBe('video/mp4');
      expect(res?.size).toBe(84167254);
    });

    test('recovers on-page video source when link redirects back to host HTML page', async () => {
      const pageHtml = `
        <html>
          <body>
            <video id="nativePlayer">
              <source src="https://www.desktophut.com/previews/preview.mp4" type="video/mp4">
            </video>
          </body>
        </html>
      `;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = typeof url === 'string' ? url : (url as Request).url;

        if (u.includes('/broken-link')) {
          return new Response(pageHtml, {
            status: 200,
            headers: new Headers({
              'Content-Type': 'text/html; charset=UTF-8',
            }),
          });
        }

        if (u.includes('/previews/preview.mp4')) {
          return new Response(null, {
            status: 200,
            headers: new Headers({
              'Content-Type': 'video/mp4',
              'Content-Length': '1719935',
            }),
          });
        }

        return new Response(null, { status: 404 });
      });

      const res = await resolveRealMediaUrl({
        url: 'https://www.desktophut.com/broken-link',
        referrer: 'https://www.desktophut.com/item',
        expectedCategory: 'video',
      });

      expect(res).not.toBeNull();
      expect(res?.resolvedUrl).toBe('https://www.desktophut.com/previews/preview.mp4');
      expect(res?.mimeType).toBe('video/mp4');
      expect(res?.size).toBe(1719935);
    });

    test('returns null when HTML contains no recoverable media (prevents saving .htm)', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response('<html><body>Login required to download</body></html>', {
          status: 200,
          headers: new Headers({
            'Content-Type': 'text/html',
          }),
        });
      });

      const res = await resolveRealMediaUrl({
        url: 'https://example.com/protected-download',
        expectedCategory: 'video',
        expectedFilename: 'movie.mp4',
      });

      expect(res).toBeNull();
    });
  });
});
