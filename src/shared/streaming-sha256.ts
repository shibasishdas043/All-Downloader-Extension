// ============================================================
//  All-Downloader — Streaming SHA-256 Implementation (FIPS 180-4)
//  Constant O(1) memory streaming hashing for files of arbitrary size
// ============================================================

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export class StreamingSha256 {
  private h0 = 0x6a09e667;
  private h1 = 0xbb67ae85;
  private h2 = 0x3c6ef372;
  private h3 = 0xa54ff53a;
  private h4 = 0x510e527f;
  private h5 = 0x9b05688c;
  private h6 = 0x1f83d9ab;
  private h7 = 0x5be0cd19;

  private block = new Uint8Array(64);
  private blockLen = 0;
  private totalBytes = 0n;
  private finalized = false;
  private readonly w = new Uint32Array(64);

  public update(chunk: Uint8Array): this {
    if (this.finalized) {
      throw new Error('StreamingSha256 already finalized');
    }
    const len = chunk.length;
    if (len === 0) return this;

    this.totalBytes += BigInt(len);
    let offset = 0;

    // Fill partial block buffer if present
    if (this.blockLen > 0) {
      const needed = 64 - this.blockLen;
      const copyLen = Math.min(needed, len);
      this.block.set(chunk.subarray(0, copyLen), this.blockLen);
      this.blockLen += copyLen;
      offset += copyLen;

      if (this.blockLen === 64) {
        this.processBlock(this.block);
        this.blockLen = 0;
      }
    }

    // Process full 64-byte blocks directly from chunk without copying
    while (offset + 64 <= len) {
      this.processBlock(chunk.subarray(offset, offset + 64));
      offset += 64;
    }

    // Retain trailing bytes
    if (offset < len) {
      const remaining = chunk.subarray(offset);
      this.block.set(remaining, 0);
      this.blockLen = remaining.length;
    }

    return this;
  }

  private processBlock(block: Uint8Array): void {
    const w = this.w;
    const view = new DataView(block.buffer, block.byteOffset, 64);

    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = this.h0;
    let b = this.h1;
    let c = this.h2;
    let d = this.h3;
    let e = this.h4;
    let f = this.h5;
    let g = this.h6;
    let h = this.h7;

    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[t] + w[t]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.h0 = (this.h0 + a) >>> 0;
    this.h1 = (this.h1 + b) >>> 0;
    this.h2 = (this.h2 + c) >>> 0;
    this.h3 = (this.h3 + d) >>> 0;
    this.h4 = (this.h4 + e) >>> 0;
    this.h5 = (this.h5 + f) >>> 0;
    this.h6 = (this.h6 + g) >>> 0;
    this.h7 = (this.h7 + h) >>> 0;
  }

  public digest(): string {
    if (!this.finalized) {
      this.finalized = true;
      const totalBits = this.totalBytes * 8n;

      // Padding: append 0x80
      this.block[this.blockLen++] = 0x80;

      // If not enough room for 8-byte length, pad block with zeroes and process
      if (this.blockLen > 56) {
        this.block.fill(0, this.blockLen, 64);
        this.processBlock(this.block);
        this.blockLen = 0;
      }

      // Pad with zeroes up to 56 bytes
      this.block.fill(0, this.blockLen, 56);

      // Append 64-bit big-endian bit length
      const view = new DataView(this.block.buffer, this.block.byteOffset, 64);
      view.setBigUint64(56, totalBits, false);
      this.processBlock(this.block);
    }

    const words = [this.h0, this.h1, this.h2, this.h3, this.h4, this.h5, this.h6, this.h7];
    return words.map(w => w.toString(16).padStart(8, '0')).join('');
  }
}

/**
 * Computes the SHA-256 hash of a Blob in bounded slices (default 4MB),
 * maintaining constant O(1) memory overhead and preventing V8 ArrayBuffer crashes on large files.
 */
export async function computeBlobSha256(
  blob: Blob,
  sliceSize = 4 * 1024 * 1024,
  onProgress?: (bytesProcessed: number, totalBytes: number) => void
): Promise<string> {
  const hasher = new StreamingSha256();
  const total = blob.size;

  if (total === 0) {
    return hasher.digest();
  }

  for (let offset = 0; offset < total; offset += sliceSize) {
    const end = Math.min(offset + sliceSize, total);
    const slice = blob.slice(offset, end);
    const buffer = await slice.arrayBuffer();
    hasher.update(new Uint8Array(buffer));
    if (onProgress) {
      onProgress(end, total);
    }
  }

  return hasher.digest();
}
