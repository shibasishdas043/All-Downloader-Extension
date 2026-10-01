import { describe, test, expect } from 'vitest';
import { StreamingSha256, computeBlobSha256 } from '../../src/shared/streaming-sha256.ts';

describe('StreamingSha256 Correctness', () => {
  test('matches standard known SHA-256 test vectors', () => {
    // 1. Empty string: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const emptyHasher = new StreamingSha256();
    expect(emptyHasher.digest()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    // 2. "abc": ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const abcHasher = new StreamingSha256();
    abcHasher.update(new TextEncoder().encode('abc'));
    expect(abcHasher.digest()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    // 3. 56-byte string test vector verified against Web Crypto
    const str = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    const longHasher = new StreamingSha256();
    longHasher.update(new TextEncoder().encode(str));
    expect(longHasher.digest()).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  test('produces identical hash when fed in multiple small arbitrary chunks vs single buffer', async () => {
    const data = new Uint8Array(123456);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 31 + 17) & 0xff;
    }

    // Compute via single update
    const h1 = new StreamingSha256();
    h1.update(data);
    const hash1 = h1.digest();

    // Compute via chunked updates of random sizes
    const h2 = new StreamingSha256();
    let pos = 0;
    while (pos < data.length) {
      const step = Math.min(data.length - pos, 1 + ((pos * 7) % 512));
      h2.update(data.subarray(pos, pos + step));
      pos += step;
    }
    const hash2 = h2.digest();

    expect(hash2).toBe(hash1);

    // Also compare against Web Crypto
    const cryptoHashBuffer = await crypto.subtle.digest('SHA-256', data);
    const cryptoHex = Array.from(new Uint8Array(cryptoHashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    expect(hash1).toBe(cryptoHex);
    expect(hash2).toBe(cryptoHex);
  });

  test('computeBlobSha256 hashes Blobs incrementally in slices without loading whole blob into buffer', async () => {
    const data = new Uint8Array(256 * 1024); // 256 KB
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;

    const blob = new Blob([data]);
    const computed = await computeBlobSha256(blob, 32 * 1024); // 32 KB slices

    const cryptoHashBuffer = await crypto.subtle.digest('SHA-256', data);
    const cryptoHex = Array.from(new Uint8Array(cryptoHashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    expect(computed).toBe(cryptoHex);
  });
});
