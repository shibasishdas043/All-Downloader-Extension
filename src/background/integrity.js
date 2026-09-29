// ============================================================
//  All-Downloader — Integrity Checker
//  SHA-256 hash verification using the Web Crypto API.
//  Zero external dependencies — fully browser-native.
// ============================================================

/**
 * Compute SHA-256 digest of an ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>} Hex string hash
 */
export async function sha256(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return bufferToHex(hashBuffer);
}

/**
 * Compute SHA-256 from a list of ArrayBuffer chunks.
 * Avoids concatenating all chunks into one giant buffer.
 * @param {ArrayBuffer[]} chunks
 * @returns {Promise<string>} Hex string hash
 */
export async function sha256Chunks(chunks) {
  // Merge all chunks into one ArrayBuffer, then hash
  const total  = chunks.reduce((acc, c) => acc + c.byteLength, 0);
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
 * @param {ArrayBuffer} buffer
 * @param {string}      expectedHex  Expected SHA-256 hex string
 * @returns {Promise<{ok: boolean, actual: string, expected: string}>}
 */
export async function verifyIntegrity(buffer, expectedHex) {
  const actual = await sha256(buffer);
  const expected = expectedHex.toLowerCase().trim();
  return {
    ok:       actual === expected,
    actual,
    expected,
  };
}

// ── Internal helpers ──────────────────────────────────────────

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
