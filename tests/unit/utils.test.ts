// ============================================================
//  Unit Tests — utils.ts
// ============================================================
import {
  formatBytes, formatSpeed, formatETA,
  getFilenameFromUrl, getExtension, truncateName,
  detectCategory, generateId, calcPercent, isValidUrl,
  relativeTime
} from '../../src/shared/utils.ts';

describe('formatBytes', () => {
  test('0 bytes',   () => expect(formatBytes(0)).toBe('0 B'));
  test('1 KB',      () => expect(formatBytes(1024)).toBe('1 KB'));
  test('1 MB',      () => expect(formatBytes(1024 * 1024)).toBe('1 MB'));
  test('1.5 GB',    () => expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB'));
});

describe('formatSpeed', () => {
  test('0 B/s',   () => expect(formatSpeed(0)).toBe('0 B/s'));
  test('KB/s',    () => expect(formatSpeed(500 * 1024)).toMatch('KB/s'));
  test('MB/s',    () => expect(formatSpeed(3 * 1024 * 1024)).toMatch('MB/s'));
});

describe('formatETA', () => {
  test('0 sec',      () => expect(formatETA(0)).toBe('--:--'));
  test('90 sec',     () => expect(formatETA(90)).toBe('01:30'));
  test('3661 sec',   () => expect(formatETA(3661)).toBe('01:01:01'));
  test('null/inf',   () => expect(formatETA(null)).toBe('--:--'));
});

describe('getFilenameFromUrl', () => {
  test('simple',    () => expect(getFilenameFromUrl('https://example.com/file.zip')).toBe('file.zip'));
  test('with query',() => expect(getFilenameFromUrl('https://cdn.example.com/video.mp4?v=3')).toBe('video.mp4'));
  test('no path',   () => expect(getFilenameFromUrl('https://example.com/')).toBe('download'));
  test('invalid',   () => expect(getFilenameFromUrl('not-a-url')).toBe('download'));
});

describe('getExtension', () => {
  test('zip', () => expect(getExtension('file.zip')).toBe('zip'));
  test('no ext', () => expect(getExtension('README')).toBe(''));
  test('case', () => expect(getExtension('video.MP4')).toBe('mp4'));
});

describe('truncateName', () => {
  test('short name unchanged', () => expect(truncateName('file.zip', 20)).toBe('file.zip'));
  test('long name truncated',  () => expect(truncateName('a'.repeat(40) + '.zip', 20).length).toBeLessThanOrEqual(20));
});

describe('detectCategory', () => {
  test('mp4 → video',   () => expect(detectCategory('movie.mp4')).toBe('video'));
  test('mp3 → audio',   () => expect(detectCategory('song.mp3')).toBe('audio'));
  test('pdf → document',() => expect(detectCategory('report.pdf')).toBe('document'));
  test('zip → archive', () => expect(detectCategory('archive.zip')).toBe('archive'));
  test('exe → application', () => expect(detectCategory('setup.exe')).toBe('application'));
  test('unknown → other',   () => expect(detectCategory('file.xyz')).toBe('other'));
});

describe('generateId', () => {
  test('starts with dl_', () => expect(generateId()).toMatch(/^dl_/));
  test('unique',          () => expect(generateId()).not.toBe(generateId()));
});

describe('calcPercent', () => {
  test('50%',  () => expect(calcPercent(50, 100)).toBe(50));
  test('100%', () => expect(calcPercent(100, 100)).toBe(100));
  test('0 total → 0', () => expect(calcPercent(50, 0)).toBe(0));
  test('caps at 100', () => expect(calcPercent(200, 100)).toBe(100));
});

describe('isValidUrl', () => {
  test('valid http',  () => expect(isValidUrl('http://example.com')).toBe(true));
  test('valid https', () => expect(isValidUrl('https://cdn.x.co/f.zip')).toBe(true));
  test('ftp invalid', () => expect(isValidUrl('ftp://x.com')).toBe(false));
  test('plain text',  () => expect(isValidUrl('not a url')).toBe(false));
});
