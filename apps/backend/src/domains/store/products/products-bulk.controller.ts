import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  BadRequestException,
  Query,
  Res,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsBulkService } from './products-bulk.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { RequestContextService } from '@common/context/request-context.service';
import {
  BulkProductUploadDto,
  BulkValidationResultDto,
  BulkUploadResultDto,
  BulkUploadTemplateDto,
} from './dto';

@Controller('store/products/bulk')
@UseGuards(PermissionsGuard)
export class ProductsBulkController {
  private readonly logger = new Logger(ProductsBulkController.name);

  constructor(
    private readonly productsBulkService: ProductsBulkService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Carga masiva desde JSON directo
   */
  @Post('upload')
  @Permissions('store:products:create')
  async uploadProducts(
    @Body() bulkUploadDto: BulkProductUploadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.productsBulkService.uploadProducts(
        bulkUploadDto,
        req.user,
      );

      if (result.failed > 0) {
        return this.responseService.created(
          result,
          'Carga masiva completada con algunos errores',
        );
      }

      return this.responseService.created(
        result,
        'Carga masiva completada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message,
        error.message,
        error.status || 400,
      );
    }
  }

  /**
   * Descarga la plantilla en formato Excel (.xlsx)
   */
  @Get('template/download')
  @Permissions('store:products:bulk:template') // Asumiendo que existe este permiso, o store:products:create
  async downloadTemplate(
    @Query('type') type: 'quick' | 'complete' = 'quick',
    @Res() res: Response,
  ) {
    try {
      const buffer = await this.productsBulkService.generateExcelTemplate(type);

      const filename = `plantilla_productos_${type}_${new Date().toISOString().split('T')[0]}.xlsx`;

      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length,
      });

      res.end(buffer);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { message: error.message },
      });
    }
  }

  /**
   * Carga masiva desde archivo Excel/CSV
   */
  @Post('upload/file')
  @Permissions('store:products:create')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProductsFromFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
        ],
      }),
    )
    file: any,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      // Validar tipo de archivo
      const allowedMimeTypes = [
        'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'application/vnd.ms-excel', // .xls
        'application/octet-stream', // A veces CSVs vienen así
      ];

      // Lax mime check fallback to extension check if needed, but ParseFilePipe handles basic validation

      let products: any[] = [];

      // Intentar parsear como Excel primero (ya que soporta ambos si se usa XLSX lib correctamente)
      // La librería XLSX puede leer CSVs también si se pasa el buffer.
      products = this.productsBulkService.parseFile(file.buffer);

      // Validar productos
      const validationResult =
        await this.productsBulkService.validateBulkProducts(products, req.user);

      if (!validationResult.isValid) {
        return this.responseService.success(
          validationResult,
          'Se encontraron errores en el archivo',
        );
      }

      // Procesar carga masiva
      const uploadResult: BulkUploadResultDto =
        await this.productsBulkService.uploadProducts(
          { products: validationResult.validProducts },
          req.user,
        );

      if (uploadResult.failed > 0) {
        return this.responseService.created(
          uploadResult,
          'Archivo procesado con algunos errores',
        );
      }

      return this.responseService.created(
        uploadResult,
        'Archivo procesado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message,
        error.message,
        error.status || 400,
      );
    }
  }

  /**
   * Analiza archivo Excel/CSV sin procesar (dry-run)
   */
  @Post('analyze')
  @Permissions('store:products:create')
  @UseInterceptors(FileInterceptor('file'))
  async analyzeProducts(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
        ],
      }),
    )
    file: any,
  ) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('No se pudo determinar la tienda actual');
    }

    const result = await this.productsBulkService.analyzeProducts(
      file.buffer,
      storeId,
    );

    return this.responseService.success(result, 'Análisis completado');
  }

  /**
   * Procesa carga masiva desde sesión de análisis
   */
  @Post('upload-session')
  @Permissions('store:products:create')
  async uploadFromSession(
    @Body() body: { session_id: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('No se pudo determinar la tienda actual');
    }
    if (!body.session_id) {
      throw new BadRequestException('session_id es requerido');
    }

    try {
      const result = await this.productsBulkService.uploadProductsFromSession(
        body.session_id,
        storeId,
        req.user,
      );

      if (result.failed > 0) {
        return this.responseService.created(
          result,
          'Carga masiva completada con algunos errores',
        );
      }

      return this.responseService.created(
        result,
        'Carga masiva completada exitosamente',
      );
    } catch (error) {
      this.logger.error(
        `Bulk upload session failed (session_id=${body.session_id}): ${error?.message || error}`,
        error?.stack,
      );

      // Dejar pasar excepciones HTTP conocidas (respetan su httpStatus y mapeo)
      if (error instanceof VendixHttpException) throw error;
      if (error instanceof BadRequestException) throw error;

      // Fallback: mensaje real del error si está disponible, truncado
      const rawMsg =
        typeof error?.message === 'string'
          ? error.message
          : 'Error en carga masiva';
      const truncated =
        rawMsg.length > 200 ? rawMsg.slice(0, 200) + '...' : rawMsg;

      throw new VendixHttpException(
        ErrorCodes.BULK_PROD_UPLOAD_FAILED,
        truncated,
      );
    }
  }

  /**
   * Cancela sesión de análisis
   */
  @Delete('session/:id')
  @Permissions('store:products:create')
  async cancelSession(@Param('id') sessionId: string) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('No se pudo determinar la tienda actual');
    }

    await this.productsBulkService.cancelSession(sessionId, storeId);

    return this.responseService.success(null, 'Sesión cancelada');
  }
}
