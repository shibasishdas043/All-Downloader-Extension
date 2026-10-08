// ============================================================
//  Unit Tests — Industry-Grade Page Sniffer Algorithm
// ============================================================
import { describe, test, expect, beforeEach } from 'vitest';
import { scrapePageMediaAndLinks } from '../../src/background/services/page-sniffer.ts';

// Helper mock element builder
interface MockNode {
  nodeType: number;
  tagName: string;
  childNodes: MockNode[];
  parentElement?: MockNode | null;
  attributes: Record<string, string>;
  style?: Record<string, string>;
  shadowRoot?: MockNode | null;
  contentDocument?: { body: MockNode } | null;
  textContent?: string;
  src?: string;
  currentSrc?: string;
  alt?: string;
  title?: string;
  href?: string;
  poster?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  clientWidth?: number;
  clientHeight?: number;
  videoWidth?: number;
  videoHeight?: number;
  width?: number;
  height?: number;
  getAttribute(name: string): string | null;
  setAttribute(name: string, val: string): void;
  querySelectorAll(sel: string): MockNode[];
}

function createMockElement(tagName: string, attrs: Record<string, any> = {}): MockNode {
  const node: MockNode = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: [],
    attributes: {},
    style: attrs.style || {},
    parentElement: null,
    getAttribute(name: string) {
      return this.attributes[name] ?? (this as any)[name] ?? null;
    },
    setAttribute(name: string, val: string) {
      this.attributes[name] = val;
      (this as any)[name] = val;
    },
    querySelectorAll(sel: string) {
      const results: MockNode[] = [];
      const matchSel = (n: MockNode) => {
        const lower = n.tagName.toLowerCase();
        if (sel === 'meta, link' && (lower === 'meta' || lower === 'link')) results.push(n);
        else if (sel.includes('application/ld+json') && lower === 'script' && n.getAttribute('type') === 'application/ld+json') results.push(n);
        for (const child of n.childNodes) matchSel(child);
      };
      for (const child of this.childNodes) matchSel(child);
      return results;
    },
    ...attrs,
  };

  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'string') {
      node.attributes[k] = v;
    }
  }

  return node;
}

function appendChild(parent: MockNode, child: MockNode) {
  child.parentElement = parent;
  parent.childNodes.push(child);
}

describe('Industry-Grade Page Sniffer Algorithm', () => {
  let mockBody: MockNode;
  let mockHead: MockNode;

  beforeEach(() => {
    mockBody = createMockElement('body');
    mockHead = createMockElement('head');

    // Global DOM mock
    (globalThis as any).document = {
      baseURI: 'https://example.com/gallery/view?id=42',
      body: mockBody,
      head: mockHead,
    };
    (globalThis as any).window = {
      location: { href: 'https://example.com/gallery/view?id=42' },
      getComputedStyle: (el: MockNode) => ({
        backgroundImage: el.style?.backgroundImage || 'none',
      }),
    };
  });

  test('extracts standard and lazy-loaded images with high-resolution tagging', () => {
    const img1 = createMockElement('img', {
      src: 'https://cdn.example.com/photos/landscape.jpg',
      alt: 'Beautiful Landscape',
      naturalWidth: 1920,
      naturalHeight: 1080,
    });
    const img2 = createMockElement('img', {
      'data-src': 'https://cdn.example.com/photos/mountain-4k.webp',
      alt: 'Mountain High Res',
      naturalWidth: 3840,
      naturalHeight: 2160,
    });
    appendChild(mockBody, img1);
    appendChild(mockBody, img2);

    const items = scrapePageMediaAndLinks();
    expect(items.length).toBe(2);

    const landscape = items.find((it) => it.url.includes('landscape.jpg'))!;
    expect(landscape).toBeDefined();
    expect(landscape.type).toBe('image');
    expect(landscape.filename).toBe('landscape.jpg');
    expect(landscape.resolution).toBe('1920×1080 (FHD)');

    const mountain = items.find((it) => it.url.includes('mountain-4k.webp'))!;
    expect(mountain).toBeDefined();
    expect(mountain.type).toBe('image');
    expect(mountain.resolution).toBe('3840×2160 (4K UHD)');
    expect(mountain.origin).toBe('lazy-img');
  });

  test('extracts responsive candidates from srcset attributes', () => {
    const img = createMockElement('img', {
      src: 'https://cdn.example.com/thumb.jpg',
      srcset: 'https://cdn.example.com/hero-320w.jpg 320w, https://cdn.example.com/hero-1280w.jpg 1280w',
      naturalWidth: 1280,
      naturalHeight: 720,
    });
    appendChild(mockBody, img);

    const items = scrapePageMediaAndLinks();
    const urls = items.map((it) => it.url);

    expect(urls).toContain('https://cdn.example.com/thumb.jpg');
    expect(urls).toContain('https://cdn.example.com/hero-320w.jpg');
    expect(urls).toContain('https://cdn.example.com/hero-1280w.jpg');
  });

  test('filters out 1x1 tracking beacons and spacer GIFs', () => {
    const pixel = createMockElement('img', {
      src: 'https://analytics.service.com/tr?pixel=1',
      naturalWidth: 1,
      naturalHeight: 1,
    });
    const spacer = createMockElement('img', {
      src: 'https://example.com/assets/spacer.gif',
      naturalWidth: 16,
      naturalHeight: 16,
    });
    const realImg = createMockElement('img', {
      src: 'https://example.com/assets/banner.png',
      naturalWidth: 800,
      naturalHeight: 200,
    });
    appendChild(mockBody, pixel);
    appendChild(mockBody, spacer);
    appendChild(mockBody, realImg);

    const items = scrapePageMediaAndLinks();
    expect(items.length).toBe(1);
    expect(items[0].filename).toBe('banner.png');
  });

  test('traverses open Shadow DOM roots in Web Components & custom video players', () => {
    const customPlayer = createMockElement('video-player-component');
    const shadowRoot = createMockElement('shadow-root');
    customPlayer.shadowRoot = shadowRoot;

    const nestedVideo = createMockElement('video', {
      src: 'https://stream.example.com/vod/episode1.mp4',
      poster: 'https://stream.example.com/vod/episode1-poster.jpg',
      videoWidth: 1920,
      videoHeight: 1080,
    });
    appendChild(shadowRoot, nestedVideo);
    appendChild(mockBody, customPlayer);

    const items = scrapePageMediaAndLinks();
    expect(items.length).toBe(2); // video + poster frame

    const vid = items.find((it) => it.type === 'video')!;
    expect(vid.url).toBe('https://stream.example.com/vod/episode1.mp4');
    expect(vid.resolution).toBe('1920×1080 (FHD)');
    expect(vid.origin).toBe('video');

    const poster = items.find((it) => it.type === 'image')!;
    expect(poster.url).toBe('https://stream.example.com/vod/episode1-poster.jpg');
    expect(poster.origin).toBe('poster');
  });

  test('extracts CSS background images from visible container elements', () => {
    const heroSection = createMockElement('section', {
      style: {
        backgroundImage: 'url("https://cdn.example.com/backgrounds/hero-mesh.png")',
      },
      clientWidth: 1200,
      clientHeight: 600,
    });
    appendChild(mockBody, heroSection);

    const items = scrapePageMediaAndLinks();
    expect(items.length).toBe(1);
    expect(items[0].url).toBe('https://cdn.example.com/backgrounds/hero-mesh.png');
    expect(items[0].type).toBe('image');
    expect(items[0].origin).toBe('css-bg');
  });

  test('extracts OpenGraph and Twitter Cards metadata from head', () => {
    const metaOgImg = createMockElement('meta', {
      property: 'og:image',
      content: 'https://cdn.example.com/social/og-preview.jpg',
    });
    const metaOgVid = createMockElement('meta', {
      property: 'og:video',
      content: 'https://cdn.example.com/social/trailer.mp4',
    });
    appendChild(mockHead, metaOgImg);
    appendChild(mockHead, metaOgVid);

    const items = scrapePageMediaAndLinks();
    expect(items.length).toBe(2);

    const img = items.find((it) => it.type === 'image')!;
    expect(img.url).toBe('https://cdn.example.com/social/og-preview.jpg');
    expect(img.origin).toBe('meta-og');

    const vid = items.find((it) => it.type === 'video')!;
    expect(vid.url).toBe('https://cdn.example.com/social/trailer.mp4');
    expect(vid.origin).toBe('meta-og');
  });

  test('extracts structured media from Schema.org JSON-LD scripts', () => {
    const jsonLd = createMockElement('script', {
      type: 'application/ld+json',
      textContent: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: 'Conference Keynote',
        contentUrl: 'https://archive.org/keynote-2026.mp4',
        thumbnailUrl: 'https://archive.org/keynote-thumb.jpg',
      }),
    });
    appendChild(mockHead, jsonLd);

    const items = scrapePageMediaAndLinks();
    expect(items.length).toBe(2);

    const vid = items.find((it) => it.type === 'video')!;
    expect(vid.url).toBe('https://archive.org/keynote-2026.mp4');
    expect(vid.title).toBe('Conference Keynote');
    expect(vid.origin).toBe('json-ld');
  });

  test('resolves filename from query parameters when pathname has no extension', () => {
    const link = createMockElement('a', {
      href: 'https://drive.example.com/download/asset?file=financial_report_2026.pdf&token=sec123',
      textContent: 'Download Annual Report',
    });
    appendChild(mockBody, link);

    const items = scrapePageMediaAndLinks();
    expect(items.length).toBe(1);
    expect(items[0].filename).toBe('financial_report_2026.pdf');
    expect(items[0].type).toBe('document');
    expect(items[0].ext).toBe('pdf');
  });

  test('prioritizes explicit download attribute on anchor tags', () => {
    const link = createMockElement('a', {
      href: 'https://files.example.com/raw/d84982a98f1',
      download: 'Firmware_v2.0.iso',
      textContent: 'Get Firmware',
    });
    appendChild(mockBody, link);

    const items = scrapePageMediaAndLinks();
    expect(items.length).toBe(1);
    expect(items[0].filename).toBe('Firmware_v2.0.iso');
    expect(items[0].type).toBe('document');
    expect(items[0].ext).toBe('iso');
  });

  test('detects streaming manifests (HLS m3u8, MPEG-DASH mpd)', () => {
    const source1 = createMockElement('source', {
      src: 'https://live.example.com/stream/master.m3u8',
      type: 'application/x-mpegURL',
    });
    const source2 = createMockElement('source', {
      src: 'https://dash.example.com/live/manifest.mpd',
      type: 'application/dash+xml',
    });
    const video = createMockElement('video');
    appendChild(video, source1);
    appendChild(video, source2);
    appendChild(mockBody, video);

    const items = scrapePageMediaAndLinks();
    expect(items.length).toBe(2);
    expect(items[0].type).toBe('video');
    expect(items[0].ext).toBe('m3u8');
    expect(items[1].type).toBe('video');
    expect(items[1].ext).toBe('mpd');
  });
});
