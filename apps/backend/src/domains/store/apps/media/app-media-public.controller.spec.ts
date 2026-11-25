import { NotFoundException } from '@nestjs/common';
import { AppMediaPublicController } from './app-media-public.controller';

describe('AppMediaPublicController — fotos de la app publicada', () => {
  function build(row: any) {
    const prisma = {
      store_app_media: { findFirst: jest.fn().mockResolvedValue(row) },
    } as any;
    const s3 = { signUrl: jest.fn(async (key: string) => `https://signed.test/${key}`) } as any;
    const controller = new AppMediaPublicController(prisma, s3);
    const res = { setHeader: jest.fn(), redirect: jest.fn() } as any;
    return { controller, prisma, s3, res };
  }

  it('redirige a una firma fresca con caché de una hora', async () => {
    const { controller, prisma, res, s3 } = build({ s3_key: 'k/a.webp', thumb_key: 'k/a_thumb.webp' });
    await controller.file('token-1', undefined, res);
    expect(prisma.store_app_media.findFirst).toHaveBeenCalledWith({
      where: { public_token: 'token-1' },
      select: { s3_key: true, thumb_key: true },
    });
    expect(s3.signUrl).toHaveBeenCalledWith('k/a.webp');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600');
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://signed.test/k/a.webp');
  });

  it('con thumb=1 sirve la miniatura', async () => {
    const { controller, res, s3 } = build({ s3_key: 'k/a.webp', thumb_key: 'k/a_thumb.webp' });
    await controller.file('token-1', '1', res);
    expect(s3.signUrl).toHaveBeenCalledWith('k/a_thumb.webp');
  });

  it('un token inexistente es 404', async () => {
    const { controller, res } = build(null);
    await expect(controller.file('nope', undefined, res)).rejects.toBeInstanceOf(NotFoundException);
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
