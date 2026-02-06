import {
  Controller,
  Post,
  Get,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsBulkImageService } from './products-bulk-image.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { RequestContextService } from '@common/context/request-context.service';

@Controller('store/products/bulk-images')
@UseGuards(PermissionsGuard)
export class ProductsBulkImageController {
  constructor(
    private readonly bulkImageService: ProductsBulkImageService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Download ZIP template (example or store-specific SKUs)
   */
  @Get('template/download')
  @Permissions('store:products:create')
  async downloadTemplate(
    @Query('type') type: 'example' | 'store-skus' = 'example',
    @Res() res: Response,
  ) {
    try {
      let buffer: Buffer;
      let filename: string;

      if (type === 'store-skus') {
        const context = RequestContextService.getContext();
        const storeId = context?.store_id;
        if (!storeId) {
          throw new BadRequestException('Store context not found');
        }
        buffer = await this.bulkImageService.generateStoreSkuTemplate(storeId);
        filename = `plantilla_imagenes_skus_${new Date().toISOString().split('T')[0]}.zip`;
      } else {
        buffer = await this.bulkImageService.generateExampleTemplate();
        filename = `plantilla_imagenes_ejemplo.zip`;
      }

      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length,
      });

      res.end(buffer);
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        error: { message: error.message },
      });
    }
  }

  /**
   * Upload a ZIP file with product images organized by SKU folders
   */
  @Post('upload')
  @Permissions('store:products:create')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImages(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 100 * 1024 * 1024 }), // 100MB
        ],
      }),
    )
    file: any,
  ) {
    try {
      const context = RequestContextService.getContext();
      const storeId = context?.store_id;

      if (!storeId) {
        throw new BadRequestException('Store context not found');
      }

      const result = await this.bulkImageService.processImageZip(
        file.buffer,
        storeId,
      );

      if (result.failed > 0) {
        return this.responseService.created(
          result,
          'Carga de imágenes completada con algunos errores',
        );
      }

      return this.responseService.created(
        result,
        'Carga de imágenes completada exitosamente',
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      return this.responseService.error(
        error.message,
        error.message,
        error.status || 400,
      );
    }
  }
}
