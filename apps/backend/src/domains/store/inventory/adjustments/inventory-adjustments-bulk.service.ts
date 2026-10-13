import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import {
  BulkAdjustmentUploadDto,
  BulkAdjustmentUploadResultDto,
  BulkAdjustmentItemResultDto,
  BulkAdjustmentAnalysisResultDto,
  BulkAdjustmentUploadSessionResultDto,
  MAX_BULK_ADJUSTMENT_UPLOAD_PAGE,
} from './dto/bulk-adjustment-upload.dto';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { buildReportBuffer } from '@common/reports/report-builder';
import type { ReportColumn } from '@common/reports/report-column.types';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '@common/services/s3.service';

/** Tamaño de grupo para los `findMany({ in })` de la validación. */
const LOOKUP_CHUNK = 1000;

@Injectable()
export class InventoryAdjustmentsBulkService {
  private readonly logger = new Logger(InventoryAdjustmentsBulkService.name);
  private readonly MAX_BATCH_SIZE = 10000;

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
    private readonly s3Service: S3Service,
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
            select: {
              sku: true,
              name: true,
              _count: { select: { product_variants: true } },
            },
          },
          product_variants: {
            select: { sku: true, name: true },
          },
        },
        orderBy: {
          products: { name: 'asc' },
        },
      });

      // Fila de variante -> SKU/nombre de la VARIANTE (el upload resuelve por
      // ese SKU). Fila base huérfana (product_variant_id null) de un producto
      // que tiene variantes: se omite, el upload la rechazaría por ambigua.
      data = stock_levels
        .filter((sl) => {
          if (sl.product_variant_id) return !!sl.product_variants?.sku;
          if (sl.products._count?.product_variants > 0) return false;
          return !!sl.products.sku;
        })
        .map((sl) => {
          const variant = sl.product_variant_id ? sl.product_variants : null;
          return {
            SKU: variant ? variant.sku : sl.products.sku,
            'Nombre Producto': variant
              ? variant.name
                ? `${sl.products.name} - ${variant.name}`
                : sl.products.name
              : sl.products.name,
            'Cantidad Actual': sl.quantity_on_hand,
            'Cantidad Nueva': '',
            'Tipo Ajuste': '',
            Descripción: '',
          };
        });
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

    // Cada columna es texto. `key === header` para preservar EXACTAMENTE los
    // encabezados (contrato round-trip: parseFile mapea POR HEADER) y reutilizar
    // las filas `data` sin reindexar.
    const columns: ReportColumn[] = headers.map(
      (header): ReportColumn => ({ key: header, header, type: 'text' }),
    );

    return buildReportBuffer({
      sheets: [{ name: 'Ajuste Masivo Inventario', columns, rows: data }],
    });
  }

  /**
   * Procesa archivo Excel/CSV para ajuste masivo de inventario (modo legacy:
   * valida y aplica todo el archivo en un solo request).
   */
  async uploadFromFile(
    file_buffer: Buffer,
    upload_dto: BulkAdjustmentUploadDto,
  ): Promise<BulkAdjustmentUploadResultDto> {
    const store_id = this.requireStoreId();
    const rows = this.parseAndCheckLimits(file_buffer);
    return this.processRows(rows, upload_dto, store_id, 0);
  }

  /**
   * Analiza el archivo (dry-run, no escribe stock), lo guarda en S3 temporal y
   * devuelve el resumen por fila para confirmar luego por paginas.
   */
  async analyzeFile(
    file_buffer: Buffer,
    upload_dto: BulkAdjustmentUploadDto,
  ): Promise<BulkAdjustmentAnalysisResultDto> {
    const store_id = this.requireStoreId();
    const rows = this.parseAndCheckLimits(file_buffer);

    const evaluation = await this.evaluateRows(rows, upload_dto, store_id, 0);

    const session_id = uuidv4();
    await this.s3Service.uploadFile(
      file_buffer,
      this.sessionKey(store_id, session_id),
      'application/octet-stream',
    );

    const errors = evaluation.results
      .filter((r) => r.status === 'error')
      .map((r) => ({
        row_number: r.row_number,
        sku: r.sku,
        message: r.message ?? '',
      }));

    return {
      session_id,
      total: rows.length,
      valid: evaluation.successful,
      failed: evaluation.failed,
      errors,
    };
  }

  /**
   * Confirma una sesion de analisis. Con `offset`/`limit` procesa solo la
   * pagina `[offset, offset + limit)`; sin ellos, el archivo completo (legacy).
   * El S3 temporal se borra solo con `done=true` (o en el modo legacy); si la
   * pagina lanza, se conserva para reintentar.
   */
  async uploadFromSession(
    session_id: string,
    upload_dto: BulkAdjustmentUploadDto,
    page?: { offset?: number; limit?: number },
  ): Promise<
    BulkAdjustmentUploadResultDto | BulkAdjustmentUploadSessionResultDto
  > {
    const store_id = this.requireStoreId();
    const s3_key = this.sessionKey(store_id, session_id);

    let file_buffer: Buffer;
    try {
      file_buffer = await this.s3Service.downloadImage(s3_key);
    } catch (error) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_SESSION_EXPIRED);
    }

    if (page && (page.offset !== undefined || page.limit !== undefined)) {
      const offset = page.offset ?? 0;
      const limit = Math.min(
        page.limit ?? MAX_BULK_ADJUSTMENT_UPLOAD_PAGE,
        MAX_BULK_ADJUSTMENT_UPLOAD_PAGE,
      );

      const all = this.parseAndCheckLimits(file_buffer);
      const total = all.length;
      if (offset >= total) {
        throw new BadRequestException(
          `El offset (${offset}) está fuera del archivo: contiene ${total} filas de datos`,
        );
      }

      const result = await this.processRows(
        all.slice(offset, offset + limit),
        upload_dto,
        store_id,
        offset,
      );
      const done = offset + limit >= total;
      if (done) {
        await this.safeDelete(s3_key);
      }
      return { ...result, total, offset, limit, done };
    }

    try {
      const rows = this.parseAndCheckLimits(file_buffer);
      return await this.processRows(rows, upload_dto, store_id, 0);
    } finally {
      await this.safeDelete(s3_key);
    }
  }

  /** Cancela una sesion de analisis y limpia el archivo temporal. */
  async cancelSession(session_id: string): Promise<void> {
    const store_id = this.requireStoreId();
    await this.safeDelete(this.sessionKey(store_id, session_id));
  }

  private sessionKey(store_id: number, session_id: string): string {
    return `tmp/bulk-adjustments/${store_id}/${session_id}.xlsx`;
  }

  private async safeDelete(key: string): Promise<void> {
    try {
      await this.s3Service.deleteFile(key);
    } catch (e) {
      // Silent cleanup failure
    }
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.INV_CONTEXT_001);
    }
    return store_id;
  }

  private parseAndCheckLimits(file_buffer: Buffer): Record<string, any>[] {
    const rows = this.parseFile(file_buffer);
    if (rows.length === 0) {
      throw new VendixHttpException(ErrorCodes.INV_BULK_001);
    }
    if (rows.length > this.MAX_BATCH_SIZE) {
      throw new VendixHttpException(ErrorCodes.INV_BULK_002);
    }
    return rows;
  }

  /** Valida las filas y aplica los ajustes validos. */
  private async processRows(
    rows: Record<string, any>[],
    upload_dto: BulkAdjustmentUploadDto,
    store_id: number,
    row_offset: number,
  ): Promise<BulkAdjustmentUploadResultDto> {
    const evaluation = await this.evaluateRows(
      rows,
      upload_dto,
      store_id,
      row_offset,
    );
    const { results, valid_items } = evaluation;
    let { successful, failed } = evaluation;

    // Ejecutar ajustes batch usando el servicio existente
    if (valid_items.length > 0) {
      // Se pide el resultado POR ÍTEM. Antes se llamaba al lote que aborta en el
      // primer fallo y el `catch` marcaba como error TODAS las filas válidas:
      // el lote no es atómico, así que las anteriores ya estaban aplicadas y el
      // reporte decía "0 exitosos, 1000 con errores" con el stock movido. El
      // operador no tenía forma de saber qué quedó hecho.
      const outcomes =
        await this.adjustmentsService.batchCreateAndCompleteSettled(
          upload_dto.location_id,
          valid_items,
        );

      // `valid_items[i]` y la fila de `results` con ajuste pendiente van en el
      // mismo orden, así que el índice del lote mapea a la fila del archivo.
      const applied_rows = evaluation.applied_rows;

      for (const outcome of outcomes) {
        if (outcome.ok) continue;
        const row = applied_rows[outcome.index];
        if (!row) continue;
        row.status = 'error';
        row.message = `Error al aplicar ajuste: ${outcome.error?.message ?? 'desconocido'}`;
        successful--;
        failed++;
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
   * Validacion pura (sin escribir): resuelve SKU -> producto/variante y el
   * stock actual con lookups agrupados (`findMany({ in })`) y arma los items
   * a ajustar. `row_offset` desplaza el numero de fila (paginas del commit).
   */
  private async evaluateRows(
    rows: Record<string, any>[],
    upload_dto: BulkAdjustmentUploadDto,
    store_id: number,
    row_offset: number,
  ): Promise<{
    results: BulkAdjustmentItemResultDto[];
    valid_items: {
      product_id: number;
      product_variant_id?: number;
      type: string;
      quantity_after: number;
      reason_code?: string;
      description?: string;
    }[];
    applied_rows: BulkAdjustmentItemResultDto[];
    successful: number;
    failed: number;
  }> {
    const results: BulkAdjustmentItemResultDto[] = [];
    const valid_items: {
      product_id: number;
      product_variant_id?: number;
      type: string;
      quantity_after: number;
      reason_code?: string;
      description?: string;
    }[] = [];
    const applied_rows: BulkAdjustmentItemResultDto[] = [];
    let successful = 0;
    let failed = 0;

    // Lookups agrupados. Match EXACTO por SKU (sin `mode: insensitive`).
    const skus = Array.from(
      new Set(
        rows
          .map((r) => r.sku?.toString().trim())
          .filter((s): s is string => !!s),
      ),
    );

    const products_by_sku = new Map<string, any>();
    for (const chunk of this.chunk(skus, LOOKUP_CHUNK)) {
      const found = await this.prisma.products.findMany({
        where: {
          store_id,
          sku: { in: chunk },
          state: { not: 'archived' },
        },
        select: {
          id: true,
          name: true,
          sku: true,
          track_inventory: true,
          product_variants: { select: { sku: true }, take: 3 },
        },
        orderBy: { id: 'asc' },
      });
      for (const p of found) {
        if (p.sku && !products_by_sku.has(p.sku)) {
          products_by_sku.set(p.sku, p);
        }
      }
    }

    const variants_by_sku = new Map<string, any>();
    const missing_skus = skus.filter((s) => !products_by_sku.has(s));
    for (const chunk of this.chunk(missing_skus, LOOKUP_CHUNK)) {
      const found = await this.prisma.product_variants.findMany({
        where: {
          sku: { in: chunk },
          products: { store_id, state: { not: 'archived' } },
        },
        select: {
          id: true,
          sku: true,
          product_id: true,
          name: true,
          track_inventory_override: true,
          products: { select: { name: true, track_inventory: true } },
        },
        orderBy: { id: 'asc' },
      });
      for (const v of found) {
        if (v.sku && !variants_by_sku.has(v.sku)) {
          variants_by_sku.set(v.sku, v);
        }
      }
    }

    // Stock actual en la ubicación, por (producto, variante).
    const product_ids = Array.from(
      new Set([
        ...Array.from(products_by_sku.values()).map((p) => p.id as number),
        ...Array.from(variants_by_sku.values()).map(
          (v) => v.product_id as number,
        ),
      ]),
    );
    const stock_by_key = new Map<string, number>();
    for (const chunk of this.chunk(product_ids, LOOKUP_CHUNK)) {
      const levels = await this.prisma.stock_levels.findMany({
        where: {
          product_id: { in: chunk },
          location_id: upload_dto.location_id,
        },
        select: {
          product_id: true,
          product_variant_id: true,
          quantity_on_hand: true,
        },
      });
      for (const l of levels) {
        stock_by_key.set(
          `${l.product_id}:${l.product_variant_id ?? 'null'}`,
          l.quantity_on_hand ?? 0,
        );
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const row_number = row_offset + i + 2; // +2 porque la fila 1 es header y el índice empieza en 0

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

      // Resolver SKU -> producto simple, o -> variante de un producto de la tienda.
      let product_id: number;
      let product_variant_id: number | null = null;
      let product_name: string;
      let track_inventory: boolean;

      const product = products_by_sku.get(sku);

      if (product) {
        if (product.product_variants?.length > 0) {
          const examples = product.product_variants
            .map((v) => v.sku)
            .join(', ');
          results.push({
            row_number,
            sku,
            product_name: product.name,
            status: 'error',
            message: `El producto ${product.name} maneja variantes: usa el SKU de la variante (p.ej. ${examples})`,
          });
          failed++;
          continue;
        }
        product_id = product.id;
        product_name = product.name;
        track_inventory = product.track_inventory;
      } else {
        const variant = variants_by_sku.get(sku);

        if (!variant) {
          results.push({
            row_number,
            sku,
            status: 'error',
            message: `Producto con SKU "${sku}" no encontrado`,
          });
          failed++;
          continue;
        }
        product_id = variant.product_id;
        product_variant_id = variant.id;
        product_name = variant.name
          ? `${variant.products.name} - ${variant.name}`
          : variant.products.name;
        track_inventory =
          variant.track_inventory_override ?? variant.products.track_inventory;
      }

      if (!track_inventory) {
        results.push({
          row_number,
          sku,
          product_name,
          status: 'error',
          message: 'El producto no tiene seguimiento de inventario habilitado',
        });
        failed++;
        continue;
      }

      const quantity_before =
        stock_by_key.get(`${product_id}:${product_variant_id ?? 'null'}`) ?? 0;

      // Si la cantidad no cambió, skip con éxito
      if (quantity_after === quantity_before) {
        results.push({
          row_number,
          sku,
          product_name,
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
        product_id,
        ...(product_variant_id ? { product_variant_id } : {}),
        type: adjustment_type,
        quantity_after: Math.floor(quantity_after),
        description,
      });

      const result_row: BulkAdjustmentItemResultDto = {
        row_number,
        sku,
        product_name,
        status: 'success',
        quantity_before,
        quantity_after: Math.floor(quantity_after),
        quantity_change: Math.floor(quantity_after) - quantity_before,
      };
      results.push(result_row);
      applied_rows.push(result_row);
      successful++;
    }

    return { results, valid_items, applied_rows, successful, failed };
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      out.push(items.slice(i, i + size));
    }
    return out;
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
