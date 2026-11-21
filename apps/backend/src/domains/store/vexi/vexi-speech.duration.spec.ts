import { estimateSpeechSeconds } from './vexi-speech.duration';

/**
 * T14 — the voice quota counts seconds of generated audio. Providers return
 * the audio without its duration, so it is read from the bytes: MP3 frame
 * headers, the WAV header, and a text-based estimate as the last resort.
 */
describe('estimateSpeechSeconds (T14)', () => {
  /** MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding: 417 bytes, 1152 samples. */
  const mp3Frame = (): Buffer => {
    const frame = Buffer.alloc(417);
    frame[0] = 0xff;
    frame[1] = 0xfb; // sync + MPEG-1 + Layer III + no CRC
    frame[2] = 0x90; // bitrate index 9 (128 kbps), 44.1 kHz, no padding
    frame[3] = 0x64;
    return frame;
  };

  const mp3 = (frames: number, id3 = false): string => {
    const parts: Buffer[] = [];
    if (id3) {
      // ID3v2 header with a 20-byte (syncsafe) tag body.
      parts.push(Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20]));
      parts.push(Buffer.alloc(20));
    }
    for (let i = 0; i < frames; i++) parts.push(mp3Frame());
    return Buffer.concat(parts).toString('base64');
  };

  it('suma la duración de los frames MP3 (100 frames ≈ 2,612 s)', () => {
    expect(estimateSpeechSeconds(mp3(100), 'audio/mpeg', 'hola')).toBeCloseTo(
      2.612,
      2,
    );
  });

  it('salta la etiqueta ID3v2 antes de contar', () => {
    expect(
      estimateSpeechSeconds(mp3(50, true), 'audio/mp3', 'hola'),
    ).toBeCloseTo(1.306, 2);
  });

  it('lee la duración de un WAV PCM por su cabecera', () => {
    const sampleRate = 24_000;
    const seconds = 1.5;
    const dataBytes = sampleRate * 2 * seconds; // 16-bit mono
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataBytes, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataBytes, 40);
    const wav = Buffer.concat([header, Buffer.alloc(dataBytes)]);

    expect(
      estimateSpeechSeconds(wav.toString('base64'), 'audio/wav', 'hola'),
    ).toBeCloseTo(1.5, 3);
  });

  it('sin cabecera legible estima por el texto hablado y la velocidad', () => {
    const text = 'a'.repeat(150);
    expect(
      estimateSpeechSeconds(Buffer.from('xyz').toString('base64'), 'audio/opus', text),
    ).toBeCloseTo(10, 5);
    expect(
      estimateSpeechSeconds('', 'audio/opus', text, 2),
    ).toBeCloseTo(5, 5);
  });

  it('nunca devuelve negativo ni NaN', () => {
    expect(estimateSpeechSeconds('', 'audio/mpeg', '')).toBe(0);
    expect(estimateSpeechSeconds('###', 'audio/mpeg', 'hola', 0)).toBeGreaterThan(
      0,
    );
  });
});
