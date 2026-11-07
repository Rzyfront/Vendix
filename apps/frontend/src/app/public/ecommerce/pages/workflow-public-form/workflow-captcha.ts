/**
 * Browser side of the proof-of-work captcha of the public flow form: finds a
 * `number` so that sha256(salt + number) starts with `difficulty` zero bits.
 * Pure JS sha256 for short messages (one block) in a loop that yields to the
 * event loop, so the page never freezes (~1 s at 18 bits on a phone).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const W = new Uint32Array(64);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 of a message shorter than 56 bytes (a single block) as eight 32-bit words. */
export function sha256Words(message: Uint8Array): Uint32Array {
  if (message.length >= 56) throw new Error('sha256Words only hashes messages shorter than 56 bytes');
  const block = new Uint8Array(64);
  block.set(message);
  block[message.length] = 0x80;
  const bits = message.length * 8;
  block[62] = (bits >>> 8) & 0xff;
  block[63] = bits & 0xff;
  for (let i = 0; i < 16; i++) {
    W[i] = (block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3];
  }
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
    const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let [a, b, c, d, e, f, g, h] = H0;
  for (let i = 0; i < 64; i++) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  const out = new Uint32Array(8);
  const v = [a, b, c, d, e, f, g, h];
  for (let i = 0; i < 8; i++) out[i] = (H0[i] + v[i]) >>> 0;
  return out;
}

/** Leading zero bits of the first 32 bits of a digest (difficulty is at most 32). */
export function leadingZeroBitsOfWord(word: number): number {
  return word === 0 ? 32 : Math.clz32(word);
}

export interface CaptchaChallenge {
  challenge: string;
  salt: string;
  algorithm: 'SHA-256';
  difficulty: number;
  expires_at: string;
  signature: string;
}

export interface CaptchaProof {
  salt: string;
  number: number;
  expires_at: string;
  signature: string;
}

const encoder = new TextEncoder();
const SLICE = 4000;
const MAX_NUMBER = 2 ** 31;

/** Solves the challenge without blocking the UI (yields every few thousand hashes). */
export async function solveCaptcha(challenge: CaptchaChallenge): Promise<CaptchaProof> {
  if (challenge.algorithm !== 'SHA-256' || challenge.difficulty > 32) {
    throw new Error('Captcha no soportado');
  }
  for (let start = 0; start < MAX_NUMBER; start += SLICE) {
    for (let n = start; n < start + SLICE; n++) {
      const words = sha256Words(encoder.encode(`${challenge.salt}${n}`));
      if (leadingZeroBitsOfWord(words[0]) >= challenge.difficulty) {
        return {
          salt: challenge.salt,
          number: n,
          expires_at: challenge.expires_at,
          signature: challenge.signature,
        };
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve));
  }
  throw new Error('No se pudo resolver la verificación');
}
