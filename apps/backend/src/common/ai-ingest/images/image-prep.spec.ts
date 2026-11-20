import {
  canDecodeHeic,
  ImagePrepError,
  isHeicBuffer,
  planStrips,
  prepareImageForAi,
  STRIP_OVERLAP,
} from './image-prep';

const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports

async function solidJpeg(
  width: number,
  height: number,
  orientation?: number,
): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  }).jpeg();
  return orientation
    ? image.withMetadata({ orientation }).toBuffer()
    : image.toBuffer();
}

async function size(buffer: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  return { width: meta.width!, height: meta.height! };
}

describe('image-prep', () => {
  it('applies the EXIF rotation: a portrait shot stored sideways comes out upright', async () => {
    // 400×100 pixels with orientation 6 (rotate 90°) = an upright 100×400 photo.
    const photo = await solidJpeg(400, 100, 6);
    const [out] = await prepareImageForAi(photo);
    expect(await size(out.buffer)).toEqual({ width: 100, height: 400 });
    expect(out.mime).toBe('image/jpeg');
  });

  it('caps the longest edge at 1536 px and never enlarges', async () => {
    const [big] = await prepareImageForAi(await solidJpeg(3000, 2000));
    expect(await size(big.buffer)).toEqual({ width: 1536, height: 1024 });
    const [small] = await prepareImageForAi(await solidJpeg(300, 200));
    expect(await size(small.buffer)).toEqual({ width: 300, height: 200 });
  });

  it('cuts a very tall photo (long list) into overlapping strips that cover it all', async () => {
    const tall = await solidJpeg(500, 3000);
    const strips = await prepareImageForAi(tall, { splitTall: true });
    expect(strips.length).toBeGreaterThan(1);
    expect(strips.every((s) => s.strips === strips.length)).toBe(true);
    expect(strips.map((s) => s.strip)).toEqual(strips.map((_, i) => i + 1));
    for (const s of strips) {
      const { width, height } = await size(s.buffer);
      expect(width).toBe(500);
      expect(height).toBeLessThanOrEqual(Math.round(500 * 1.4));
    }
    // Without splitTall the same photo is one scaled image.
    expect(await prepareImageForAi(tall)).toHaveLength(1);
  });

  it('measures the strips on the EXIF-rotated image', async () => {
    // Stored 3000×500 with orientation 6 → upright 500×3000 (tall).
    const strips = await prepareImageForAi(await solidJpeg(3000, 500, 6), { splitTall: true });
    expect(strips.length).toBeGreaterThan(1);
    expect((await size(strips[0].buffer)).width).toBe(500);
  });

  it('planStrips: overlap, full coverage and the strip cap', () => {
    expect(planStrips(1000, 1500)).toEqual([]);
    const boxes = planStrips(500, 3000);
    expect(boxes[0].top).toBe(0);
    const last = boxes[boxes.length - 1];
    expect(last.top + last.height).toBe(3000);
    for (let i = 1; i < boxes.length; i += 1) {
      const prevEnd = boxes[i - 1].top + boxes[i - 1].height;
      expect(boxes[i].top).toBeLessThan(prevEnd);
      expect(prevEnd - boxes[i].top).toBeGreaterThanOrEqual(Math.floor(boxes[i].height * STRIP_OVERLAP) - 1);
    }
    const capped = planStrips(100, 100_000, 4);
    expect(capped).toHaveLength(4);
    expect(capped[3].top + capped[3].height).toBe(100_000);
  });

  it('HEIC: a clear Spanish error when this sharp build cannot decode it', async () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypheic'),
      Buffer.alloc(32),
    ]);
    expect(isHeicBuffer(heic)).toBe(true);
    if (canDecodeHeic()) return; // a custom libvips build reads it
    await expect(prepareImageForAi(heic)).rejects.toMatchObject({
      reason: 'unsupported',
      message: expect.stringContaining('HEIC'),
    });
  });

  it('garbage bytes are an ImagePrepError, never the raw buffer', async () => {
    await expect(prepareImageForAi(Buffer.from('not an image'))).rejects.toBeInstanceOf(
      ImagePrepError,
    );
  });
});
