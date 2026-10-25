// ============================================================
//  All-Downloader — HLS / M3U8 & DASH Manifest Parser
//  Pure TypeScript, zero external dependencies.
//  Parses master playlists, media playlists, variants, segments,
//  encryption tags, and resolves relative URLs against base URL.
// ============================================================

export interface HlsSegment {
  /** Absolute, fully qualified URL of the .ts or .m4s segment */
  url: string;
  /** Duration of the segment in seconds (from #EXTINF) */
  duration: number;
  /** Sequence number in the stream */
  sequenceNumber: number;
  /** Optional byte-range offset and length (from #EXT-X-BYTERANGE) */
  byteRange?: { offset: number; length: number };
  /** Optional segment title */
  title?: string;
}

export interface HlsMediaPlaylist {
  isMaster: false;
  /** True if #EXT-X-ENDLIST is missing (ongoing live broadcast) */
  isLive: boolean;
  /** Target duration of segments in seconds (#EXT-X-TARGETDURATION) */
  targetDuration: number;
  /** Ordered list of playable segments */
  segments: HlsSegment[];
  /** Total calculated duration of the stream in seconds */
  totalDuration: number;
  /** True if #EXT-X-KEY specifies AES-128 or other encryption */
  hasEncryption: boolean;
  /** Encryption method if present (e.g. 'AES-128', 'SAMPLE-AES') */
  encryptionMethod?: string;
  /** Key URI if encrypted */
  keyUrl?: string;
  /** Initial media sequence number (#EXT-X-MEDIA-SEQUENCE) */
  mediaSequence: number;
}

export interface HlsVariant {
  bandwidth: number;
  resolution?: string;
  codecs?: string;
  url: string;
  name?: string;
}

export interface HlsMasterPlaylist {
  isMaster: true;
  variants: HlsVariant[];
}

export type HlsParsedResult = HlsMediaPlaylist | HlsMasterPlaylist;

/**
 * Resolves a potentially relative URL against a base URL.
 */
function resolveUrl(relativeOrAbsolute: string, baseUrl: string): string {
  try {
    return new URL(relativeOrAbsolute.trim(), baseUrl).href;
  } catch {
    return relativeOrAbsolute.trim();
  }
}

/**
 * Parses an attribute list formatted as: KEY1=VAL1,KEY2="VAL2",KEY3=123
 */
function parseAttributeList(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(attrString)) !== null) {
    const key = match[1];
    const val = match[2] !== undefined ? match[2] : match[3];
    attrs[key] = val;
  }
  return attrs;
}

/**
 * Parses an M3U8 playlist text string into a master or media playlist.
 */
export function parseM3U8(text: string, baseUrl: string): HlsParsedResult {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0 || !lines[0].startsWith('#EXTM3U')) {
    throw new Error('Invalid M3U8 playlist: missing #EXTM3U header');
  }

  // Check if master playlist
  const isMaster = lines.some(l => l.startsWith('#EXT-X-STREAM-INF'));

  if (isMaster) {
    const variants: HlsVariant[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const attrStr = line.slice('#EXT-X-STREAM-INF:'.length);
        const attrs = parseAttributeList(attrStr);
        const bandwidth = parseInt(attrs['BANDWIDTH'] || attrs['AVERAGE-BANDWIDTH'] || '0', 10);
        const resolution = attrs['RESOLUTION'];
        const codecs = attrs['CODECS'];
        const name = attrs['NAME'];

        // Next non-comment line is the URI
        let urlLine = '';
        for (let j = i + 1; j < lines.length; j++) {
          if (!lines[j].startsWith('#')) {
            urlLine = lines[j];
            i = j;
            break;
          }
        }

        if (urlLine) {
          variants.push({
            bandwidth,
            resolution,
            codecs,
            name,
            url: resolveUrl(urlLine, baseUrl),
          });
        }
      }
    }

    return {
      isMaster: true,
      variants,
    };
  }

  // Media Playlist
  let isLive = true;
  let targetDuration = 5;
  let mediaSequence = 0;
  let hasEncryption = false;
  let encryptionMethod: string | undefined;
  let keyUrl: string | undefined;
  const segments: HlsSegment[] = [];
  let currentDuration = 0;
  let currentTitle: string | undefined;
  let currentByteRange: { offset: number; length: number } | undefined;
  let lastByteRangeEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = parseFloat(line.split(':')[1]) || 5;
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = parseInt(line.split(':')[1], 10) || 0;
    } else if (line.startsWith('#EXT-X-ENDLIST')) {
      isLive = false;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-KEY:'.length));
      if (attrs['METHOD'] && attrs['METHOD'] !== 'NONE') {
        hasEncryption = true;
        encryptionMethod = attrs['METHOD'];
        if (attrs['URI']) {
          keyUrl = resolveUrl(attrs['URI'], baseUrl);
        }
      }
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const rangeStr = line.slice('#EXT-X-BYTERANGE:'.length);
      const parts = rangeStr.split('@');
      const length = parseInt(parts[0], 10);
      const offset = parts[1] !== undefined ? parseInt(parts[1], 10) : lastByteRangeEnd;
      currentByteRange = { offset, length };
      lastByteRangeEnd = offset + length;
    } else if (line.startsWith('#EXTINF:')) {
      const infContent = line.slice('#EXTINF:'.length);
      const commaIdx = infContent.indexOf(',');
      if (commaIdx >= 0) {
        currentDuration = parseFloat(infContent.slice(0, commaIdx)) || 0;
        currentTitle = infContent.slice(commaIdx + 1).trim();
      } else {
        currentDuration = parseFloat(infContent) || 0;
        currentTitle = undefined;
      }
    } else if (!line.startsWith('#')) {
      // Segment URI
      const segUrl = resolveUrl(line, baseUrl);
      segments.push({
        url: segUrl,
        duration: currentDuration,
        sequenceNumber: mediaSequence + segments.length,
        byteRange: currentByteRange,
        title: currentTitle,
      });

      // Reset per-segment values
      currentDuration = 0;
      currentTitle = undefined;
      currentByteRange = undefined;
    }
  }

  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);

  return {
    isMaster: false,
    isLive,
    targetDuration,
    segments,
    totalDuration,
    hasEncryption,
    encryptionMethod,
    keyUrl,
    mediaSequence,
  };
}

/**
 * Selects the best variant stream from a master playlist (highest bandwidth).
 */
export function selectBestVariant(master: HlsMasterPlaylist): HlsVariant | null {
  if (!master.variants || master.variants.length === 0) return null;
  const sorted = [...master.variants].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
  return sorted[0];
}

/**
 * Lightweight DASH MPD manifest parser for common SegmentTemplate patterns.
 */
export function parseMPD(xmlText: string, baseUrl: string): HlsMediaPlaylist {
  // Extract Period and Representation
  const segments: HlsSegment[] = [];
  let isLive = xmlText.includes('type="dynamic"');

  // Match media template
  const templateMatch = xmlText.match(/media="([^"]+)"/);
  const initMatch = xmlText.match(/initialization="([^"]+)"/);
  const repMatch = xmlText.match(/<Representation[^>]+id="([^"]+)"[^>]*>/);
  const timescaleMatch = xmlText.match(/timescale="([0-9]+)"/);
  const durationMatch = xmlText.match(/duration="([0-9]+)"/);

  const mediaTpl = templateMatch ? templateMatch[1] : '';
  const repId = repMatch ? repMatch[1] : '1';
  const timescale = timescaleMatch ? parseInt(timescaleMatch[1], 10) : 1000;
  const duration = durationMatch ? parseInt(durationMatch[1], 10) : 2000;
  const segDuration = duration / timescale;

  if (mediaTpl) {
    // Generate up to 500 segments or parse SegmentTimeline
    const timelineMatches = Array.from(xmlText.matchAll(/<S\s+(?:t="([0-9]+)"\s+)?d="([0-9]+)"(?:\s+r="([0-9]+)")?/g));
    if (timelineMatches.length > 0) {
      let seq = 1;
      for (const m of timelineMatches) {
        const d = parseInt(m[2], 10) / timescale;
        const repeat = m[3] ? parseInt(m[3], 10) : 0;
        for (let r = 0; r <= repeat; r++) {
          const segUrl = resolveUrl(
            mediaTpl.replace(/\$RepresentationID\$/g, repId).replace(/\$Number\$/g, String(seq)),
            baseUrl
          );
          segments.push({
            url: segUrl,
            duration: d,
            sequenceNumber: seq,
          });
          seq++;
        }
      }
    }
  }

  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);

  return {
    isMaster: false,
    isLive,
    targetDuration: segDuration || 4,
    segments,
    totalDuration,
    hasEncryption: xmlText.includes('ContentProtection'),
    mediaSequence: 1,
  };
}
