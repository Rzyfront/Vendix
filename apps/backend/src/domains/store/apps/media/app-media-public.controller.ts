import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../../auth/decorators/public.decorator';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { S3Service } from '@common/services/s3.service';

/**
 * Medios de las apps, servidos a la página pública.
 *
 * La app guarda `/public/apps/media/:id` (estable); este endpoint firma el
 * objeto en cada visita y redirige, así que el enlace no vence nunca. No lleva
 * permiso: son las fotos que la propia página publica.
 */
@Controller('public/apps/media')
export class AppMediaPublicController {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly s3: S3Service,
  ) {}

  @Public()
  @Get(':token')
  async file(
    @Param('token') token: string,
    @Query('thumb') thumb: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // El borrado es lógico: una página ya publicada sigue resolviendo su foto.
    // Se busca por el token opaco (no por id): con ids correlativos, cualquiera
    // podía pedir el medio de otra tienda cambiando el número.
    const row = await this.prisma.store_app_media.findFirst({
      where: { public_token: token },
      select: { s3_key: true, thumb_key: true },
    });
    if (!row) throw new NotFoundException('Medio no encontrado');
    const key = thumb === '1' && row.thumb_key ? row.thumb_key : row.s3_key;
    const url = await this.s3.signUrl(key);
    if (!url) throw new NotFoundException('Medio no disponible');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.redirect(302, url);
  }
}
