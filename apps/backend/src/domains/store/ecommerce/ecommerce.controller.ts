import { Controller, Get, Patch, Post, Body, Param, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '../../../common/responses/response.service';
import { EcommerceService } from './ecommerce.service';
import { UpdateEcommerceSettingsDto } from './dto/ecommerce-settings.dto';

@Controller('store/ecommerce')
export class EcommerceController {
  constructor(
    private readonly ecommerceService: EcommerceService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('settings')
  @Permissions('store:ecommerce:read')
  async getSettings() {
    try {
      const settings = await this.ecommerceService.getSettings();

      if (!settings) {
        // No existe configuración - modo setup
        return this.responseService.success(
          { exists: false },
          'No existe configuración de e-commerce. Requiere setup.',
        );
      }

      return this.responseService.success(
        {
          exists: true,
          config: settings.config,
          ecommerceUrl: settings.ecommerceUrl,
        },
        'Configuración de e-commerce obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener la configuración',
        error.message,
      );
    }
  }

  @Get('template/:type')
  @Permissions('store:ecommerce:read')
  async getTemplate(@Param('type') type: 'basic' | 'advanced') {
    try {
      const template = await this.ecommerceService.getDefaultTemplate(type);
      return this.responseService.success(
        template,
        'Template de e-commerce obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener el template',
        error.message,
      );
    }
  }

  @Post('upload-slider-image')
  @Permissions('store:ecommerce:update')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSliderImage(@UploadedFile() file: Express.Multer.File) {
    try {
      if (!file) {
        return this.responseService.error(
          'No se proporcionó archivo',
          'File is required',
        );
      }

      // Validar tipo de archivo
      if (!file.mimetype.startsWith('image/')) {
        return this.responseService.error(
          'Tipo de archivo inválido',
          'Only image files are allowed',
        );
      }

      const result = await this.ecommerceService.uploadSliderImage(
        file.buffer,
        `slider-${Date.now()}.webp`,
      );

      return this.responseService.created(
        result,
        'Imagen subida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al subir la imagen',
        error.message,
      );
    }
  }

  @Patch('settings')
  @Permissions('store:ecommerce:update')
  async updateSettings(@Body() settingsDto: UpdateEcommerceSettingsDto) {
    try {
      const settings = await this.ecommerceService.updateSettings(
        settingsDto.ecommerce,
      );

      return this.responseService.updated(
        settings,
        'Configuración de e-commerce actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al actualizar la configuración',
        error.message,
      );
    }
  }
}
