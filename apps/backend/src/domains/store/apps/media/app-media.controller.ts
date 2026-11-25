import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { app_kind_enum } from '@prisma/client';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { APP_MEDIA_MAX_BATCH, AppMediaService } from './app-media.service';

/**
 * Apps — biblioteca de medios (apps-customization F1.1).
 *
 * Subir, listar, renombrar (alt) y borrar las fotos propias de la tienda. Cada
 * app referencia estos medios por id; el archivo vive en nuestro storage.
 */
@Controller('store/apps/media')
@UseGuards(PermissionsGuard)
export class AppMediaController {
  constructor(
    private readonly media: AppMediaService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('store:apps:read')
  @Get()
  async list(
    @Query('app_kind') appKind?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.media.list({
      appKind: this.parseAppKind(appKind),
      search: search ?? null,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return this.responseService.success(result);
  }

  @Permissions('store:apps:manage')
  @Post()
  @UseInterceptors(
    FilesInterceptor('files', APP_MEDIA_MAX_BATCH, {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024, files: APP_MEDIA_MAX_BATCH },
    }),
  )
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('app_kind') appKind?: string,
  ) {
    const saved = await this.media.upload(files, this.parseAppKind(appKind));
    return this.responseService.created(saved, 'Medios cargados');
  }

  @Permissions('store:apps:manage')
  @Patch(':id')
  async updateAlt(
    @Param('id', ParseIntPipe) id: number,
    @Body('alt') alt?: string,
  ) {
    const row = await this.media.updateAlt(id, alt ?? null);
    return this.responseService.success(row, 'Texto alternativo actualizado');
  }

  @Permissions('store:apps:manage')
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.media.remove(id);
    return this.responseService.success(result, 'Medio eliminado');
  }

  private parseAppKind(value?: string | null): app_kind_enum | null {
    if (!value) return null;
    return Object.values(app_kind_enum).includes(value as app_kind_enum)
      ? (value as app_kind_enum)
      : null;
  }
}
