// ============================================================
//  Unit Tests — HLS / M3U8 Manifest Parser
// ============================================================
import { describe, test, expect } from 'vitest';
import {
  parseM3U8,
  selectBestVariant,
  parseMPD,
  type HlsMasterPlaylist,
  type HlsMediaPlaylist,
} from '../../src/background/services/hls-parser.js';

describe('parseM3U8 — Media Playlist', () => {
  const sampleMediaPlaylist = `
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:100
#EXTINF:9.009,
segment_100.ts
#EXTINF:9.009,
segment_101.ts
#EXTINF:4.500,
sub/segment_102.ts
#EXT-X-ENDLIST
  `.trim();

  test('parses basic segments and calculates total duration', () => {
    const parsed = parseM3U8(sampleMediaPlaylist, 'https://cdn.example.com/video/playlist.m3u8') as HlsMediaPlaylist;

    expect(parsed.isMaster).toBe(false);
    expect(parsed.isLive).toBe(false);
    expect(parsed.targetDuration).toBe(10);
    expect(parsed.mediaSequence).toBe(100);
    expect(parsed.segments).toHaveLength(3);

    expect(parsed.segments[0].url).toBe('https://cdn.example.com/video/segment_100.ts');
    expect(parsed.segments[0].duration).toBeCloseTo(9.009);
    expect(parsed.segments[0].sequenceNumber).toBe(100);

    expect(parsed.segments[1].url).toBe('https://cdn.example.com/video/segment_101.ts');
    expect(parsed.segments[1].sequenceNumber).toBe(101);

    expect(parsed.segments[2].url).toBe('https://cdn.example.com/video/sub/segment_102.ts');
    expect(parsed.totalDuration).toBeCloseTo(22.518);
  });

  test('detects live stream when #EXT-X-ENDLIST is missing', () => {
    const livePlaylist = `
#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
live_1.ts
#EXTINF:6.0,
live_2.ts
    `.trim();

    const parsed = parseM3U8(livePlaylist, 'https://live.tv/stream.m3u8') as HlsMediaPlaylist;
    expect(parsed.isLive).toBe(true);
    expect(parsed.segments).toHaveLength(2);
  });

  test('detects AES-128 encryption flag and key URI', () => {
    const encryptedPlaylist = `
#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-KEY:METHOD=AES-128,URI="https://auth.example.com/key.bin",IV=0x1234567890ABCDEF
#EXTINF:10.0,
enc_01.ts
#EXT-X-ENDLIST
    `.trim();

    const parsed = parseM3U8(encryptedPlaylist, 'https://cdn.example.com/enc.m3u8') as HlsMediaPlaylist;
    expect(parsed.hasEncryption).toBe(true);
    expect(parsed.encryptionMethod).toBe('AES-128');
    expect(parsed.keyUrl).toBe('https://auth.example.com/key.bin');
  });

  test('parses #EXT-X-BYTERANGE correctly', () => {
    const byteRangePlaylist = `
#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-BYTERANGE:500000@0
#EXTINF:10.0,
single_file.ts
#EXT-X-BYTERANGE:500000@500000
#EXTINF:10.0,
single_file.ts
#EXT-X-ENDLIST
    `.trim();

    const parsed = parseM3U8(byteRangePlaylist, 'https://cdn.example.com/video.m3u8') as HlsMediaPlaylist;
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0].byteRange).toEqual({ offset: 0, length: 500000 });
    expect(parsed.segments[1].byteRange).toEqual({ offset: 500000, length: 500000 });
  });

  test('throws on missing #EXTM3U header', () => {
    expect(() => parseM3U8('not an m3u8 file', 'https://example.com')).toThrow();
  });
});

describe('parseM3U8 — Master Playlist & Variant Selection', () => {
  const masterPlaylist = `
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,NAME="360p"
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",NAME="1080p"
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,NAME="720p"
720p/index.m3u8
  `.trim();

  test('parses variants from master playlist and resolves URLs', () => {
    const parsed = parseM3U8(masterPlaylist, 'https://video.site.com/hls/master.m3u8') as HlsMasterPlaylist;

    expect(parsed.isMaster).toBe(true);
    expect(parsed.variants).toHaveLength(3);

    expect(parsed.variants[0].bandwidth).toBe(800000);
    expect(parsed.variants[0].resolution).toBe('640x360');
    expect(parsed.variants[0].url).toBe('https://video.site.com/hls/360p/index.m3u8');

    expect(parsed.variants[1].bandwidth).toBe(5000000);
    expect(parsed.variants[1].resolution).toBe('1920x1080');
    expect(parsed.variants[1].codecs).toContain('avc1');
    expect(parsed.variants[1].url).toBe('https://video.site.com/hls/1080p/index.m3u8');
  });

  test('selectBestVariant selects highest bandwidth stream', () => {
    const parsed = parseM3U8(masterPlaylist, 'https://video.site.com/hls/master.m3u8') as HlsMasterPlaylist;
    const best = selectBestVariant(parsed);

    expect(best).not.toBeNull();
    expect(best?.bandwidth).toBe(5000000);
    expect(best?.resolution).toBe('1920x1080');
    expect(best?.url).toBe('https://video.site.com/hls/1080p/index.m3u8');
  });
});

describe('parseMPD', () => {
  const sampleMpd = `
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" minBufferTime="PT1.5S" type="static" mediaPresentationDuration="PT30S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="video_1080" bandwidth="4000000" width="1920" height="1080">
        <SegmentTemplate timescale="1000" duration="4000" media="chunk_$RepresentationID$_$Number$.m4s" initialization="init.mp4">
          <SegmentTimeline>
            <S t="0" d="4000" r="2" />
          </SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
  `.trim();

  test('parses SegmentTimeline and produces segment list', () => {
    const parsed = parseMPD(sampleMpd, 'https://dash.example.com/manifest.mpd');
    expect(parsed.isLive).toBe(false);
    expect(parsed.segments.length).toBeGreaterThan(0);
    expect(parsed.segments[0].url).toContain('chunk_video_1080_1.m4s');
  });
});
