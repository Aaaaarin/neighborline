/**
 * Hashcash-style proof of work for the human check (THREAT_MODEL T37/R9), shared by the browser
 * (solver) and the server (verifier uses node:crypto, same digest).
 *
 * The server issues an HMAC-signed challenge bound to the visitor and an expiry. The browser must find,
 * for each i in 0..count-1, a 32-bit n such that SHA-256("<challenge>.<i>.<n>") starts with `bits` zero
 * bits. Several small puzzles instead of one big one keep the solve time predictable (the sum of
 * `count` geometric draws varies far less than one draw), around 200 ms on a laptop by default. Nothing
 * is shown to the visitor: no image, no puzzle, nothing to read or hear.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const W = new Uint32Array(64);
const ror = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** One SHA-256 compression of buf[off..off+64) into state (in place). */
function compress(state: Int32Array, buf: Uint8Array, off: number): void {
  for (let t = 0; t < 16; t++) {
    const j = off + t * 4;
    W[t] = (buf[j]! << 24) | (buf[j + 1]! << 16) | (buf[j + 2]! << 8) | buf[j + 3]!;
  }
  for (let t = 16; t < 64; t++) {
    const w15 = W[t - 15]!, w2 = W[t - 2]!;
    const s0 = ror(w15, 7) ^ ror(w15, 18) ^ (w15 >>> 3);
    const s1 = ror(w2, 17) ^ ror(w2, 19) ^ (w2 >>> 10);
    W[t] = (W[t - 16]! + s0 + W[t - 7]! + s1) | 0;
  }
  let a = state[0]!, b = state[1]!, c = state[2]!, d = state[3]!, e = state[4]!, f = state[5]!, g = state[6]!, h = state[7]!;
  for (let t = 0; t < 64; t++) {
    const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[t]! + W[t]!) | 0;
    const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  state[0] = (state[0]! + a) | 0; state[1] = (state[1]! + b) | 0; state[2] = (state[2]! + c) | 0; state[3] = (state[3]! + d) | 0;
  state[4] = (state[4]! + e) | 0; state[5] = (state[5]! + f) | 0; state[6] = (state[6]! + g) | 0; state[7] = (state[7]! + h) | 0;
}

/**
 * A hasher for `${prefix}${n}` with the prefix's full 64-byte blocks compressed once (the midstate), so
 * each candidate costs one or two compressions and no allocation. Returns the digest's first 32 bits.
 */
export function prefixHasher(prefix: string): (n: number) => number {
  const bytes = Uint8Array.from(prefix, (ch) => ch.charCodeAt(0) & 0xff);
  const full = bytes.length - (bytes.length % 64);
  const mid = Int32Array.from(H0);
  const head = new Uint8Array(full);
  head.set(bytes.subarray(0, full));
  for (let off = 0; off < full; off += 64) compress(mid, head, off);
  const rest = bytes.subarray(full);
  const tail = new Uint8Array(128); // rest (< 64) + up to 10 digits + 0x80 + length: at most 2 blocks
  tail.set(rest);
  const state = new Int32Array(8);
  return (n: number) => {
    let len = rest.length;
    const digits = String(n);
    for (let i = 0; i < digits.length; i++) tail[len++] = digits.charCodeAt(i);
    tail[len] = 0x80;
    const blocks = len + 9 <= 64 ? 64 : 128;
    tail.fill(0, len + 1, blocks);
    const bitLen = (full + len) * 8;
    tail[blocks - 4] = bitLen >>> 24;
    tail[blocks - 3] = (bitLen >>> 16) & 0xff;
    tail[blocks - 2] = (bitLen >>> 8) & 0xff;
    tail[blocks - 1] = bitLen & 0xff;
    state.set(mid);
    compress(state, tail, 0);
    if (blocks === 128) compress(state, tail, 64);
    return state[0]! >>> 0;
  };
}

/** Does a digest whose first 32 bits are `word` start with `bits` zero bits (1..32)? */
export const meetsBits = (word: number, bits: number): boolean => (bits >= 32 ? word === 0 : word >>> 0 < 2 ** (32 - bits));

/** Puzzle i hashes `${powPrefix(challenge, i)}${n}`. */
export const powPrefix = (challenge: string, i: number): string => `${challenge}.${i}.`;

export interface PowPuzzle {
  challenge: string;
  bits: number;
  count: number;
}

/**
 * Solve in slices so the page stays responsive (yields to the event loop every `sliceMs`). Returns one
 * n per puzzle. `signal` aborts (the page was left).
 */
export async function solvePow(p: PowPuzzle, opts: { sliceMs?: number; signal?: AbortSignal; yieldFn?: () => Promise<void> } = {}): Promise<number[]> {
  if (!(p.bits >= 1 && p.bits <= 32) || !(p.count >= 1 && p.count <= 64)) throw new Error('bad puzzle');
  const slice = opts.sliceMs ?? 12;
  const yieldFn = opts.yieldFn ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const out: number[] = [];
  let i = 0;
  let hash = prefixHasher(powPrefix(p.challenge, 0));
  let n = 0;
  while (i < p.count) {
    const until = Date.now() + slice;
    while (i < p.count && Date.now() < until) {
      const stop = n + 4096;
      for (; n < stop; n++) {
        if (meetsBits(hash(n), p.bits)) {
          out.push(n);
          i++;
          if (i < p.count) hash = prefixHasher(powPrefix(p.challenge, i));
          n = 0;
          break;
        }
      }
      if (n > 0xffffffff) throw new Error('no solution in range');
    }
    if (opts.signal?.aborted) throw new Error('aborted');
    if (i < p.count) await yieldFn();
  }
  return out;
}
