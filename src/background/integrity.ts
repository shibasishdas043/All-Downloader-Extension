// ============================================================
//  All-Downloader — Integrity Checker (TypeScript)
//  SHA-256 hash verification using the Web Crypto API.
//  Zero external dependencies — fully browser-native.
// ============================================================

export interface IntegrityResult {
  ok: boolean;
  actual: string;
  expected: string;
}

/**
 * Compute SHA-256 digest of an ArrayBuffer.
 */
export async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return bufferToHex(hashBuffer);
}

/**
 * Compute SHA-256 from a list of ArrayBuffer chunks.
 * Avoids concatenating all chunks into one giant buffer.
 */
export async function sha256Chunks(chunks: ArrayBuffer[]): Promise<string> {
  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return sha256(merged.buffer);
}

/**
 * Verify a downloaded file's hash against an expected value.
 */
export async function verifyIntegrity(buffer: ArrayBuffer, expectedHex: string): Promise<IntegrityResult> {
  const actual = await sha256(buffer);
  const expected = expectedHex.toLowerCase().trim();
  return {
    ok: actual === expected,
    actual,
    expected,
  };
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
