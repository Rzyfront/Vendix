import {
  buildVisionImageParts,
  configSupportsVision,
  type VisionAttachmentsPort,
} from './vex-vision';

describe('Vex vision gate', () => {
  const rows = [
    { attachment_id: 'att_1', original_name: 'vitrina.jpg', mime_type: 'image/jpeg' },
    { attachment_id: 'att_2', original_name: 'lista.pdf', mime_type: 'application/pdf' },
    { attachment_id: 'att_3', original_name: 'foto.heic', mime_type: 'image/heic' },
    { attachment_id: 'att_4', original_name: 'caja.png', mime_type: 'image/png' },
  ];
  const port = (): VisionAttachmentsPort => ({
    describeMany: jest.fn().mockResolvedValue(rows),
    signedUrl: jest.fn(async (h: string) => `https://s3.example/${h}?sig=1`),
  });

  it('reads settings.supports_vision, defaulting to false', () => {
    expect(configSupportsVision({ supports_vision: true })).toBe(true);
    expect(configSupportsVision({ supports_vision: false })).toBe(false);
    expect(configSupportsVision({ supports_vision: 'true' })).toBe(false);
    expect(configSupportsVision({})).toBe(false);
    expect(configSupportsVision(null)).toBe(false);
    expect(configSupportsVision(undefined)).toBe(false);
  });

  it('turns only jpeg/png/webp into image_url parts with a 900 s URL', async () => {
    const p = port();
    const parts = await buildVisionImageParts(p, ['att_1', 'att_2', 'att_3', 'att_4']);
    expect(parts.map((x) => x.image_url?.url)).toEqual([
      'https://s3.example/att_1?sig=1',
      'https://s3.example/att_4?sig=1',
    ]);
    expect(parts.every((x) => x.type === 'image_url')).toBe(true);
    expect(p.signedUrl).toHaveBeenCalledWith('att_1', 900);
  });

  it('never makes an image part from a PDF', async () => {
    const p = port();
    (p.describeMany as jest.Mock).mockResolvedValue([rows[1]]);
    expect(await buildVisionImageParts(p, ['att_2'])).toEqual([]);
  });

  it('caps at 5 images and skips the lookup without handles', async () => {
    const p = port();
    (p.describeMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        attachment_id: `att_${i}`,
        original_name: `f${i}.png`,
        mime_type: 'image/png',
      })),
    );
    expect(await buildVisionImageParts(p, ['x'])).toHaveLength(5);
    expect(await buildVisionImageParts(p, undefined)).toEqual([]);
    expect(await buildVisionImageParts(p, [])).toEqual([]);
  });
});
