/**
 * Headerless PCM → playable WAV.
 *
 * Gemini text-to-speech answers with raw PCM (16-bit little-endian, mono) on
 * every route: directly from the Generative Language API and through
 * OpenRouter's `/audio/speech`. A browser cannot play PCM without a header,
 * and the voice quota reads the real duration from the WAV header, so every
 * provider that receives Gemini audio wraps it here — one implementation.
 */

/** Gemini's native output rate, used when the response does not state one. */
export const PCM_DEFAULT_SAMPLE_RATE = 24000;

const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/** Reads `rate=24000` from a mime such as `audio/L16;codec=pcm;rate=24000`. */
export function sampleRateFromMime(mime: string | null | undefined): number {
  const match = /rate=(\d+)/i.exec(mime || '');
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : PCM_DEFAULT_SAMPLE_RATE;
}

/** Canonical 44-byte RIFF/WAVE header for 16-bit mono PCM. */
export function wrapPcmAsWav(pcm: Buffer, sampleRate: number): Buffer {
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
