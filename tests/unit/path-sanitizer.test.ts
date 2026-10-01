// ============================================================
//  Unit Tests — path-sanitizer.ts
// ============================================================
import { describe, test, expect } from 'vitest';
import {
  sanitizeFilename,
  sanitizeFolderSegment,
  buildSavePath,
  escapeRegex,
} from '../../src/background/services/path-sanitizer.js';

describe('sanitizeFilename', () => {
  test('strips illegal filename characters', () => {
    expect(sanitizeFilename('file*name?.zip')).toBe('file_name_.zip');
    expect(sanitizeFilename('folder/sub/test.mp4')).toBe('folder_sub_test.mp4');
    expect(sanitizeFilename('file:with"quotes<and>pipes|')).toBe('file_with_quotes_and_pipes_');
  });

  test('handles Windows reserved device names', () => {
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFilename('aux.pdf')).toBe('_aux.pdf');
    expect(sanitizeFilename('nul')).toBe('_nul');
    expect(sanitizeFilename('COM1.dat')).toBe('_COM1.dat');
  });

  test('collapses consecutive whitespace and trims', () => {
    expect(sanitizeFilename('  my   cool   song.mp3  ')).toBe('my cool song.mp3');
  });

  test('falls back to default on empty or invalid inputs', () => {
    expect(sanitizeFilename('')).toBe('download');
    expect(sanitizeFilename('...')).toBe('_');
    expect(sanitizeFilename(null as any)).toBe('download');
  });
});

describe('sanitizeFolderSegment', () => {
  test('sanitizes folder segments correctly', () => {
    expect(sanitizeFolderSegment('my<folder>')).toBe('my_folder_');
    expect(sanitizeFolderSegment('..')).toBe('');
    expect(sanitizeFolderSegment('COM3')).toBe('');
  });
});

describe('buildSavePath', () => {
  test('returns filename if subFolder is empty', () => {
    expect(buildSavePath('', 'test.zip')).toBe('test.zip');
    expect(buildSavePath('   ', 'test.zip')).toBe('test.zip');
  });

  test('normalizes slashes and builds correct nested path', () => {
    expect(buildSavePath('downloads\\media', 'song.mp3')).toBe('downloads/media/song.mp3');
    expect(buildSavePath('/sub/path/', 'video.mp4')).toBe('sub/path/video.mp4');
  });

  test('handles optional category folder correctly', () => {
    expect(buildSavePath('AllDownloader', 'ubuntu.iso', 'Archives')).toBe('AllDownloader/Archives/ubuntu.iso');
    expect(buildSavePath('', 'clip.mp4', 'Videos')).toBe('Videos/clip.mp4');
  });
});

describe('escapeRegex', () => {
  test('escapes special regex characters', () => {
    expect(escapeRegex('file.test (1)[2]?+$*^')).toBe('file\\.test \\(1\\)\\[2\\]\\?\\+\\$\\*\\^');
  });
});
