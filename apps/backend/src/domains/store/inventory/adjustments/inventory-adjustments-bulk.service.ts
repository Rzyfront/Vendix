import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import {
  BulkAdjustmentUploadDto,
  BulkAdjustmentUploadResultDto,
  BulkAdjustmentItemResultDto,
} from './dto/bulk-adjustment-upload.dto';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import * as XLSX from 'xlsx';

@Injectable()
export class InventoryAdjustmentsBulkService {
  private readonly logger = new Logger(InventoryAdjustmentsBulkService.name);
  private readonly MAX_BATCH_SIZE = 1000;

  private readonly HEADER_TRANSLATIONS: Record<string, string> = {
    sku: 'sku',
    código: 'sku',
    codigo: 'sku',
    'código producto': 'sku',
    'codigo producto': 'sku',
    'cantidad nueva': 'quantity_after',
    cantidad: 'quantity_after',
    'new quantity': 'quantity_after',
    quantity: 'quantity_after',
    'tipo ajuste': 'type',
    tipo: 'type',
    type: 'type',
    descripción: 'description',
    descripcion: 'description',
    description: 'description',
    'nombre producto': '_product_name',
    nombre: '_product_name',
    'cantidad actual': '_current_quantity',
  };

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly adjustmentsService: InventoryAdjustmentsService,
  ) {}

  /**
   * Genera la plantilla Excel para ajuste masivo de inventario
   * Si se pasa location_id, la plantilla se pre-pobla con productos y stock actual
   */
  async generateExcelTemplate(location_id?: number): Promise<Buffer> {
    const headers = [
      'SKU',
      'Nombre Producto',
      'Cantidad Actual',
      'Cantidad Nueva',
      'Tipo Ajuste',
      'Descripción',
    ];

    let data: any[] = [];

    if (location_id) {
      // Template pre-poblado con stock actual
      const stock_levels = await this.prisma.stock_levels.findMany({
        where: {
          location_id: location_id,
          quantity_on_hand: { gt: 0 },
          products: {
            state: { not: 'archived' },
            track_inventory: true,
          },
        },
        include: {
          products: {
            select: { sku: true, name: true },
          },
        },
        orderBy: {
          products: { name: 'asc' },
        },
      });

      data = stock_levels
        .filter((sl) => sl.products.sku)
        .map((sl) => ({
          SKU: sl.products.sku,
          'Nombre Producto': sl.products.name,
          'Cantidad Actual': sl.quantity_on_hand,
          'Cantidad Nueva': '',
          'Tipo Ajuste': '',
          Descripción: '',
        }));
    }

    if (data.length === 0) {
      // Template vacío con ejemplos
      data = [
        {
          SKU: 'PROD-001',
          'Nombre Producto': 'Producto Ejemplo 1',
          'Cantidad Actual': '(se ignora)',
          'Cantidad Nueva': 50,
          'Tipo Ajuste': 'count_variance',
          Descripción: 'Conteo físico',
        },
        {
          SKU: 'PROD-002',
          'Nombre Producto': 'Producto Ejemplo 2',
          'Cantidad Actual': '(se ignora)',
          'Cantidad Nueva': 30,
          'Tipo Ajuste': '',
          Descripción: '',
        },
        {
          SKU: 'PROD-003',
          'Nombre Producto': 'Producto Ejemplo 3',
          'Cantidad Actual': '(se ignora)',
          'Cantidad Nueva': 0,
          'Tipo Ajuste': 'damage',
          Descripción: 'Mercancía dañada',
        },
      ];
    }

    const ws = XLSX.utils.json_to_sheet(data, { header: headers });

    // Ajustar ancho de columnas
    const col_widths = headers.map((h) => ({
      wch: Math.max(h.length + 5, 20),
    }));
    ws['!cols'] = col_widths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ajuste Masivo Inventario');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Procesa archivo Excel/CSV para ajuste masivo de inventario
   */
  async uploadFromFile(
    file_buffer: Buffer,
    upload_dto: BulkAdjustmentUploadDto,
  ): Promise<BulkAdjustmentUploadResultDto> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.INV_CONTEXT_001);
    }

    // 1. Parsear archivo
    const rows = this.parseFile(file_buffer);

    if (rows.length === 0) {
      throw new VendixHttpException(ErrorCodes.INV_BULK_001);
    }

    if (rows.length > this.MAX_BATCH_SIZE) {
      throw new VendixHttpException(ErrorCodes.INV_BULK_002);
    }

    // 2. Validar y resolver SKUs → product_ids
    const results: BulkAdjustmentItemResultDto[] = [];
    const valid_items: {
      product_id: number;
      product_variant_id?: number;
      type: string;
      quantity_after: number;
      reason_code?: string;
      description?: string;
    }[] = [];
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const row_number = i + 2; // +2 porque la fila 1 es header y el índice empieza en 0

      const sku = row.sku?.toString().trim();
      if (!sku) {
        results.push({
          row_number,
          sku: '',
          status: 'error',
          message: 'SKU vacío o no proporcionado',
        });
        failed++;
        continue;
      }

      // Validar que quantity_after sea un número válido >= 0
      const quantity_after = Number(row.quantity_after);
      if (isNaN(quantity_after) || quantity_after < 0) {
        results.push({
          row_number,
          sku,
          status: 'error',
          message: `Cantidad inválida: ${row.quantity_after}. Debe ser un número >= 0`,
        });
        failed++;
        continue;
      }

      // Buscar producto por SKU en la tienda actual
      const product = await this.prisma.products.findFirst({
        where: {
          store_id,
          sku,
          state: { not: 'archived' },
        },
        select: {
          id: true,
          name: true,
          sku: true,
          track_inventory: true,
        },
      });

      if (!product) {
        results.push({
          row_number,
          sku,
          status: 'error',
          message: `Producto con SKU "${sku}" no encontrado`,
        });
        failed++;
        continue;
      }

      if (!product.track_inventory) {
        results.push({
          row_number,
          sku,
          product_name: product.name,
          status: 'error',
          message: 'El producto no tiene seguimiento de inventario habilitado',
        });
        failed++;
        continue;
      }

      // Obtener stock actual en la ubicación
      const current_stock = await this.prisma.stock_levels.findFirst({
        where: {
          product_id: product.id,
          product_variant_id: null,
          location_id: upload_dto.location_id,
        },
      });

      const quantity_before = current_stock?.quantity_on_hand ?? 0;

      // Si la cantidad no cambió, skip con éxito
      if (quantity_after === quantity_before) {
        results.push({
          row_number,
          sku,
          product_name: product.name,
          status: 'success',
          message: 'Sin cambios - cantidad igual a la actual',
          quantity_before,
          quantity_after,
          quantity_change: 0,
        });
        successful++;
        continue;
      }

      // Determinar tipo de ajuste: por fila o global
      const row_type = this.normalizeAdjustmentType(row.type);
      const adjustment_type =
        row_type || upload_dto.adjustment_type || 'count_variance';

      const description =
        row.description?.toString().trim() ||
        upload_dto.description ||
        'Ajuste masivo de inventario';

      valid_items.push({
        product_id: product.id,
        type: adjustment_type,
        quantity_after: Math.floor(quantity_after),
        description,
      });

      results.push({
        row_number,
        sku,
        product_name: product.name,
        status: 'success',
        quantity_before,
        quantity_after: Math.floor(quantity_after),
        quantity_change: Math.floor(quantity_after) - quantity_before,
      });
      successful++;
    }

    // 3. Ejecutar ajustes batch usando el servicio existente
    if (valid_items.length > 0) {
      try {
        await this.adjustmentsService.batchCreateAndComplete(
          upload_dto.location_id,
          valid_items,
        );
      } catch (error) {
        this.logger.error(`Error en batch de ajustes: ${error.message}`);
        // Marcar todos los items válidos como error
        for (const result of results) {
          if (result.status === 'success' && result.quantity_change !== 0) {
            result.status = 'error';
            result.message = `Error al aplicar ajuste: ${error.message}`;
            successful--;
            failed++;
          }
        }
      }
    }

    return {
      success: failed === 0,
      total_processed: rows.length,
      successful,
      failed,
      results,
    };
  }

  /**
   * Parsea archivo Excel/CSV a array de objetos con header mapping
   */
  private parseFile(buffer: Buffer): Record<string, any>[] {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet_name = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheet_name];

      const json_data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (json_data.length < 2) {
        throw new BadRequestException(
          'El archivo debe contener al menos una fila de encabezados y una fila de datos',
        );
      }

      // Procesar encabezados
      const raw_headers = json_data[0] as string[];
      const header_map: Record<number, string> = {};

      raw_headers.forEach((h, index) => {
        if (!h) return;
        const normalized = h.toString().trim().toLowerCase();
        const dto_key = this.HEADER_TRANSLATIONS[normalized];
        if (dto_key) {
          header_map[index] = dto_key;
        }
      });

      // Verificar que al menos SKU y cantidad estén mapeados
      const mapped_keys = Object.values(header_map);
      if (!mapped_keys.includes('sku')) {
        throw new BadRequestException(
          'No se encontró la columna SKU en el archivo. Columnas esperadas: SKU, Cantidad Nueva',
        );
      }
      if (!mapped_keys.includes('quantity_after')) {
        throw new BadRequestException(
          'No se encontró la columna de cantidad en el archivo. Columnas esperadas: SKU, Cantidad Nueva',
        );
      }

      const rows: Record<string, any>[] = [];

      for (let i = 1; i < json_data.length; i++) {
        const row_data = json_data[i] as any[];
        if (!row_data || row_data.length === 0) continue;

        const row: Record<string, any> = {};
        let has_data = false;

        row_data.forEach((cell_value, index) => {
          const key = header_map[index];
          if (key && !key.startsWith('_')) {
            // Ignorar columnas de referencia (prefijo _)
            const val =
              cell_value === undefined || cell_value === null ? '' : cell_value;

            if (key === 'quantity_after') {
              const num = parseFloat(val);
              row[key] = isNaN(num) ? val : num;
            } else {
              row[key] = val;
            }

            if (val !== '') has_data = true;
          }
        });

        if (has_data && row['sku']) {
          rows.push(row);
        }
      }

      return rows;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'Error al procesar el archivo: ' + error.message,
      );
    }
  }

  /**
   * Normaliza el tipo de ajuste desde texto libre (español/inglés)
   */
  private normalizeAdjustmentType(type?: any): string | null {
    if (!type) return null;

    const normalized = type.toString().trim().toLowerCase();
    const type_map: Record<string, string> = {
      // Valores directos
      damage: 'damage',
      loss: 'loss',
      theft: 'theft',
      expiration: 'expiration',
      count_variance: 'count_variance',
      manual_correction: 'manual_correction',
      // Español
      daño: 'damage',
      dano: 'damage',
      pérdida: 'loss',
      perdida: 'loss',
      robo: 'theft',
      hurto: 'theft',
      expiración: 'expiration',
      expiracion: 'expiration',
      vencimiento: 'expiration',
      conteo: 'count_variance',
      'varianza conteo': 'count_variance',
      'corrección manual': 'manual_correction',
      'correccion manual': 'manual_correction',
      corrección: 'manual_correction',
      correccion: 'manual_correction',
    };

    return type_map[normalized] || null;
  }
}
