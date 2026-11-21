/**
 * T14 — duration of a synthesized segment, for the per-agent voice quota
 * («segundos de audio generado al mes», §3.7).
 *
 * Providers return the audio without a duration, so it is read from the bytes:
 * MP3 frame headers (the default format), the WAV header, and only when
 * neither parses, an estimate from the spoken text. The text estimate exists so
 * an unknown format still meters something instead of nothing.
 */

/** Spanish TTS reads ~15 characters per second at speed 1. */
const CHARS_PER_SECOND = 15;

/** Bitrates (kbps) by version family and layer, indexed by the header field. */
const BITRATES: Record<string, number[]> = {
  'v1-l1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  'v1-l2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  'v1-l3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  'v2-l1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  'v2-l2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  'v2-l3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
};

export function estimateSpeechSeconds(
  audioBase64: string,
  contentType: string,
  spokenText: string,
  speed: number = 1,
): number {
  let bytes: Buffer | null = null;
  try {
    bytes = audioBase64 ? Buffer.from(audioBase64, 'base64') : null;
  } catch {
    bytes = null;
  }

  if (bytes && bytes.length) {
    const type = (contentType || '').toLowerCase();
    if (type.includes('wav') || isRiffWave(bytes)) {
      const wav = wavSeconds(bytes);
      if (wav !== null) return wav;
    }
    if (type.includes('mpeg') || type.includes('mp3') || looksLikeMp3(bytes)) {
      const mp3 = mp3Seconds(bytes);
      if (mp3 !== null) return mp3;
    }
  }

  return textSeconds(spokenText, speed);
}

function textSeconds(text: string, speed: number): number {
  const chars = (text || '').trim().length;
  if (!chars) return 0;
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return chars / (CHARS_PER_SECOND * rate);
}

function isRiffWave(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WAVE'
  );
}

/** Walks the RIFF chunks for `fmt ` (byte rate) and `data` (size). */
function wavSeconds(bytes: Buffer): number | null {
  if (!isRiffWave(bytes)) return null;
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 16 <= bytes.length) {
      byteRate = bytes.readUInt32LE(offset + 16);
    } else if (id === 'data') {
      // Streaming encoders write 0 or 0xFFFFFFFF: fall back to what arrived.
      dataSize =
        size === 0 || size === 0xffffffff
          ? bytes.length - (offset + 8)
          : Math.min(size, bytes.length - (offset + 8));
      break;
    }
    offset += 8 + size + (size % 2);
  }
  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : null;
}

function id3Length(bytes: Buffer): number {
  if (bytes.length < 10 || bytes.toString('ascii', 0, 3) !== 'ID3') return 0;
  // Syncsafe integer: 7 bits per byte.
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  const footer = bytes[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

function looksLikeMp3(bytes: Buffer): boolean {
  const start = id3Length(bytes);
  return (
    bytes.length > start + 1 &&
    bytes[start] === 0xff &&
    (bytes[start + 1] & 0xe0) === 0xe0
  );
}

/**
 * Sums the duration of every MPEG audio frame. Stops at the first byte that
 * is not a valid frame header after at least one frame, which tolerates a
 * trailing ID3v1 tag or padding.
 */
function mp3Seconds(bytes: Buffer): number | null {
  let offset = id3Length(bytes);
  let seconds = 0;
  let frames = 0;

  while (offset + 4 <= bytes.length) {
    const b1 = bytes[offset + 1];
    const b2 = bytes[offset + 2];
    if (bytes[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) {
      if (frames) break;
      offset++;
      continue;
    }
    const versionBits = (b1 >> 3) & 0x03; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    const layerBits = (b1 >> 1) & 0x03; // 3 = I, 2 = II, 1 = III
    const bitrateIndex = (b2 >> 4) & 0x0f;
    const sampleIndex = (b2 >> 2) & 0x03;
    const padding = (b2 >> 1) & 0x01;

    const rates = SAMPLE_RATES[versionBits];
    if (
      !rates ||
      layerBits === 0 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15 ||
      sampleIndex === 3
    ) {
      if (frames) break;
      offset++;
      continue;
    }

    const layer = 4 - layerBits; // 1, 2 or 3
    const family = versionBits === 3 ? 'v1' : 'v2';
    const bitrate = BITRATES[`${family}-l${layer}`][bitrateIndex] * 1000;
    const sampleRate = rates[sampleIndex];
    const samples =
      layer === 1 ? 384 : layer === 3 && versionBits !== 3 ? 576 : 1152;
    const length =
      layer === 1
        ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
        : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
    if (length <= 4) break;

    seconds += samples / sampleRate;
    frames++;
    offset += length;
  }

  return frames ? seconds : null;
}
