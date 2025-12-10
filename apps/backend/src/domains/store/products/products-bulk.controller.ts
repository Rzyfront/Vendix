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
} from '@nestjs/common';
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
  constructor(
    private readonly productsBulkService: ProductsBulkService,
    private readonly responseService: ResponseService,
  ) { }

  /**
   * Carga masiva de productos desde JSON
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
          'Carga masiva de productos completada con algunos errores',
        );
      }

      return this.responseService.created(
        result,
        'Carga masiva de productos completada exitosamente',
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
   * Valida productos antes de la carga masiva
   */
  @Post('validate')
  @Permissions('store:products:create')
  async validateProducts(
    @Body() bulkUploadDto: BulkProductUploadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result: BulkValidationResultDto =
        await this.productsBulkService.validateBulkProducts(
          bulkUploadDto.products,
          req.user,
        );

      if (!result.isValid) {
        return this.responseService.success(
          result,
          'Se encontraron errores en la validación',
        );
      }

      return this.responseService.success(
        result,
        'Validación de productos completada exitosamente',
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
   * Obtiene la plantilla para carga masiva
   */
  @Get('template')
  @Permissions('store:products:create')
  async getTemplate() {
    try {
      const template: BulkUploadTemplateDto =
        await this.productsBulkService.getBulkUploadTemplate();
      return this.responseService.success(
        template,
        'Plantilla de carga masiva obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message,
        error.message,
        error.status || 500,
      );
    }
  }

  /**
   * Descarga la plantilla en formato CSV
   */
  @Get('template/download')
  @Permissions('store:products:create')
  async downloadTemplate() {
    try {
      const template: BulkUploadTemplateDto =
        await this.productsBulkService.getBulkUploadTemplate();

      // Generar contenido CSV
      const csvContent = this.generateCsvFromTemplate(template);

      return {
        csv: csvContent,
        filename: `product-bulk-template-${new Date().toISOString().split('T')[0]}.csv`,
      };
    } catch (error) {
      return this.responseService.error(
        error.message,
        error.message,
        error.status || 500,
      );
    }
  }

  /**
   * Carga masiva desde archivo CSV
   */
  @Post('upload/csv')
  @Permissions('store:products:create')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProductsFromFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: 'text/csv' }),
        ],
      }),
    )
    file: any,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      // Validar tipo de archivo
      if (!file.mimetype.includes('csv')) {
        throw new BadRequestException('Solo se permiten archivos CSV');
      }

      // Validar que el archivo no esté vacío
      if (!file.buffer || file.buffer.length === 0) {
        throw new BadRequestException('El archivo está vacío');
      }

      // Parsear CSV
      const products = await this.parseCsvFile(file.buffer);

      // Validar productos
      const validationResult =
        await this.productsBulkService.validateBulkProducts(products, req.user);

      if (!validationResult.isValid) {
        return this.responseService.success(
          validationResult,
          'Se encontraron errores en el archivo CSV',
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
   * Genera contenido CSV a partir de la plantilla
   */
  private generateCsvFromTemplate(template: BulkUploadTemplateDto): string {
    const headers = template.headers.join(',');
    const rows = template.sample_data.map((row) =>
      template.headers
        .map((header) => {
          const value = row[header] || '';
          // Escapar comas y comillas
          return typeof value === 'string' &&
            (value.includes(',') || value.includes('"'))
            ? `"${value.replace(/"/g, '""')}"`
            : value;
        })
        .join(','),
    );

    return [headers, ...rows].join('\n');
  }

  /**
   * Parsea archivo CSV a array de productos
   */
  private async parseCsvFile(buffer: Buffer): Promise<any[]> {
    try {
      const csvContent = buffer.toString('utf-8');
      const lines = csvContent.split('\n').filter((line) => line.trim());

      if (lines.length < 2) {
        throw new BadRequestException(
          'El archivo CSV debe contener al menos una fila de encabezados y una fila de datos',
        );
      }

      const headers = lines[0].split(',').map((header) => header.trim());
      const products: Record<string, any>[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const values = this.parseCsvLine(line);

        if (values.length !== headers.length) {
          throw new BadRequestException(
            `Formato de archivo CSV inválido en línea ${i + 1}`,
          );
        }

        const product: Record<string, any> = {};
        headers.forEach((header, index) => {
          const value = values[index].trim();

          // Convertir tipos de datos según el campo
          switch (header) {
            case 'base_price':
            case 'stock_quantity':
            case 'cost_price':
            case 'weight':
              product[header] = value ? parseFloat(value) : undefined;
              break;
            case 'brand_id':
              product[header] = value ? parseInt(value, 10) : undefined;
              break;
            case 'category_ids':
              product[header] = value
                ? value.split(',').map((id) => parseInt(id.trim(), 10))
                : [];
              break;
            default:
              product[header] = value || undefined;
          }
        });

        products.push(product);
      }

      return products;
    } catch (error) {
      throw new BadRequestException(
        'Error al procesar el archivo CSV: ' + error.message,
      );
    }
  }

  /**
   * Parsea una línea CSV considerando comillas y escapes
   */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Comilla escapada
          current += '"';
          i++; // Saltar la siguiente comilla
        } else {
          // Inicio o fin de campo entre comillas
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // Fin del campo
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    // Agregar el último campo
    result.push(current);

    return result;
  }
}
