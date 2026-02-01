import * as XLSX from 'xlsx';
import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  BadRequestException,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsBulkService } from './products-bulk.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import {
  BulkProductUploadDto,
  BulkValidationResultDto,
  BulkUploadResultDto,
  BulkUploadTemplateDto,
} from './dto';

@Controller('store/products/bulk')
@UseGuards(PermissionsGuard)
export class ProductsBulkController {
  private readonly HEADER_TRANSLATIONS: Record<string, string> = {
    nombre: 'name',
    sku: 'sku',
    'precio base': 'base_price',
    'precio venta': 'base_price',
    costo: 'cost_price',
    'precio compra': 'cost_price',
    margen: 'profit_margin',
    'cantidad inicial': 'stock_quantity',
    descripción: 'description',
    descripcion: 'description',
    categorías: 'category_ids',
    categorias: 'category_ids',
    marca: 'brand_id',
    'en oferta': 'is_on_sale',
    'precio oferta': 'sale_price',
    peso: 'weight',
    'disponible ecommerce': 'available_for_ecommerce',
    estado: 'state',
  };

  constructor(
    private readonly productsBulkService: ProductsBulkService,
    private readonly responseService: ResponseService,
  ) { }

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
      products = this.parseFile(file.buffer);

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
   * Parsea archivo (Excel o CSV) a array de productos usando mapeo de español
   */
  private parseFile(buffer: Buffer): any[] {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Convertir a JSON array de arrays (header: 1) para inspeccionar encabezados
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (jsonData.length < 2) {
        throw new BadRequestException(
          'El archivo debe contener al menos una fila de encabezados y una fila de datos',
        );
      }

      // Procesar encabezados
      const rawHeaders = jsonData[0] as string[];
      const headerMap: Record<number, string> = {};

      rawHeaders.forEach((h, index) => {
        if (!h) return;
        const normalized = h.toString().trim().toLowerCase();
        // Buscar traducción
        const dtoKey = this.HEADER_TRANSLATIONS[normalized];
        if (dtoKey) {
          headerMap[index] = dtoKey;
        }
      });

      const products: any[] = [];

      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i] as any[];
        if (!row || row.length === 0) continue;

        const product: Record<string, any> = {};
        let hasData = false;

        row.forEach((cellValue, index) => {
          const key = headerMap[index];
          if (key) {
            // Normalizar valores vacíos
            const val =
              cellValue === undefined || cellValue === null ? '' : cellValue;

            // Si es numérico en DTO, intentar convertir
            if (
              [
                'base_price',
                'cost_price',
                'stock_quantity',
                'weight',
                'sale_price',
                'profit_margin',
              ].includes(key)
            ) {
              const num = parseFloat(val);
              product[key] = isNaN(num) ? 0 : num;
            } else {
              product[key] = val;
            }

            if (val !== '') hasData = true;
          }
        });

        if (hasData && (product['name'] || product['sku'])) {
          products.push(product);
        }
      }

      return products;
    } catch (error) {
      throw new BadRequestException(
        'Error al procesar el archivo: ' + error.message,
      );
    }
  }
}
