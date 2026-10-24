import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  InventoryAdjustmentsService,
  BatchAdjustmentInput,
  AdjustmentTransactionResult,
} from './inventory-adjustments.service';
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
import { parseMoneyCell } from '@common/money-kernel';
import { generateSlug } from '@common/utils/slug.util';
import { StoreSkuGeneratorService } from './store-sku-generator.service';
import type { AdjustmentType } from './interfaces/inventory-adjustment.interface';

/** Tamaño de grupo para los `findMany({ in })` de la validación. */
const LOOKUP_CHUNK = 1000;

/** Fila del archivo que crea un producto nuevo (carga inicial). */
interface NewProductRow {
  row_number: number;
  /** SKU del archivo; null = se autogenerará. */
  sku: string | null;
  auto_sku: boolean;
  name: string;
  quantity: number;
  base_price: number | null;
  unit_cost: number | null;
  description: string;
  result_row: BulkAdjustmentItemResultDto;
}

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
    'nombre producto': 'name',
    nombre: 'name',
    name: 'name',
    'precio venta': 'base_price',
    'precio de venta': 'base_price',
    'precio compra': 'unit_cost',
    'precio de compra': 'unit_cost',
    costo: 'unit_cost',
    'cantidad actual': '_current_quantity',
  };

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly adjustmentsService: InventoryAdjustmentsService,
    private readonly s3Service: S3Service,
    private readonly skuGenerator: StoreSkuGeneratorService,
  ) {}

  /**
   * Genera la plantilla Excel para ajuste masivo de inventario.
   * - `existing` (default si llega `location_id`): TODOS los productos físicos
   *   con seguimiento de inventario de la tienda (y una fila por variante) con
   *   la cantidad actual en esa ubicación (0 si no hay stock_level).
   * - `example` (default sin `location_id`): filas de ejemplo.
   */
  async generateExcelTemplate(
    location_id?: number,
    mode?: string,
  ): Promise<Buffer> {
    const resolved_mode =
      mode === 'example' || mode === 'existing'
        ? mode
        : location_id
          ? 'existing'
          : 'example';

    if (resolved_mode === 'existing' && !location_id) {
      throw new BadRequestException(
        'El modo "existing" requiere el parámetro location_id',
      );
    }

    const headers = [
      'SKU',
      'Nombre Producto',
      'Cantidad Actual',
      'Cantidad Nueva',
      'Tipo Ajuste',
      'Descripción',
      'Precio Venta',
      'Precio Compra',
    ];

    let data: any[] = [];

    if (resolved_mode === 'existing') {
      const store_id = this.requireStoreId();
      const products = await this.prisma.products.findMany({
        where: {
          store_id,
          product_type: 'physical',
          track_inventory: true,
          state: { not: 'archived' },
        },
        select: {
          id: true,
          sku: true,
          name: true,
          product_variants: {
            select: { id: true, sku: true, name: true },
            orderBy: { id: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      });

      const stock_by_key = new Map<string, number>();
      const product_ids = products.map((p) => p.id);
      for (const chunk of this.chunk(product_ids, LOOKUP_CHUNK)) {
        const levels = await this.prisma.stock_levels.findMany({
          where: { product_id: { in: chunk }, location_id },
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

      // Sin variantes: fila del producto. Con variantes: una fila por variante
      // con el SKU de la variante (el upload resuelve por ese SKU).
      for (const p of products) {
        if (p.product_variants.length === 0) {
          if (!p.sku) continue;
          data.push({
            SKU: p.sku,
            'Nombre Producto': p.name,
            'Cantidad Actual': stock_by_key.get(`${p.id}:null`) ?? 0,
            'Cantidad Nueva': '',
            'Tipo Ajuste': '',
            Descripción: '',
            'Precio Venta': '',
            'Precio Compra': '',
          });
          continue;
        }
        for (const v of p.product_variants) {
          if (!v.sku) continue;
          data.push({
            SKU: v.sku,
            'Nombre Producto': v.name ? `${p.name} - ${v.name}` : p.name,
            'Cantidad Actual': stock_by_key.get(`${p.id}:${v.id}`) ?? 0,
            'Cantidad Nueva': '',
            'Tipo Ajuste': '',
            Descripción: '',
            'Precio Venta': '',
            'Precio Compra': '',
          });
        }
      }
    } else {
      data = [
        {
          SKU: 'PROD-001',
          'Nombre Producto': 'Producto Ejemplo 1',
          'Cantidad Actual': '(se ignora)',
          'Cantidad Nueva': 50,
          'Tipo Ajuste': 'count_variance',
          Descripción: 'Conteo físico',
          'Precio Venta': '',
          'Precio Compra': '',
        },
        {
          SKU: 'PROD-003',
          'Nombre Producto': 'Producto Ejemplo 3',
          'Cantidad Actual': '(se ignora)',
          'Cantidad Nueva': 0,
          'Tipo Ajuste': 'damage',
          Descripción: 'Mercancía dañada',
          'Precio Venta': '',
          'Precio Compra': '',
        },
        {
          // Producto nuevo: SKU vacío = se autogenera (CI-{tienda}-{NNNNNN}).
          SKU: '',
          'Nombre Producto': 'Producto Nuevo Ejemplo',
          'Cantidad Actual': '(se ignora)',
          'Cantidad Nueva': 20,
          'Tipo Ajuste': '',
          Descripción: 'Carga inicial',
          'Precio Venta': 15000,
          'Precio Compra': 9000,
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
      warnings: evaluation.results.flatMap((r) =>
        (r.warnings ?? []).map((message) => ({
          row_number: r.row_number,
          sku: r.sku,
          message,
        })),
      ),
      initial_load_rows: evaluation.valid_items.filter(
        (item) => item.type === 'initial_load',
      ).length,
      new_products: evaluation.new_rows.length,
      auto_sku: evaluation.new_rows.filter((n) => n.auto_sku).length,
      requires_initial_load_ack: evaluation.new_rows.length > 0,
      new_product_rows: evaluation.new_rows.slice(0, 50).map((n) => ({
        row_number: n.row_number,
        sku: n.sku,
        name: n.name,
        quantity: n.quantity,
      })),
    };
  }

  /**
   * Confirma una sesion de analisis. Con `offset`/`limit` procesa solo la
   * pagina `[offset, offset + limit)`; sin ellos, el archivo completo (legacy).
   * Conserva el archivo temporal hasta cancelación/lifecycle para poder
   * reintentar incluso una última página cuya respuesta se perdió.
   */
  async uploadFromSession(
    session_id: string,
    upload_dto: BulkAdjustmentUploadDto & { initial_load_ack?: boolean },
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
      // El archivo COMPLETO manda: si crea productos y no hay ack, se rechaza
      // antes de escribir cualquier página.
      if (upload_dto.initial_load_ack !== true) {
        const full = await this.evaluateRows(all, upload_dto, store_id, 0);
        this.assertInitialLoadAck(full.new_rows.length, upload_dto);
      }
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
        session_id,
      );
      const done = offset + limit >= total;
      // No borrar al completar: si se pierde la respuesta de la última página,
      // el mismo session_id debe poder devolver sus recibos ya confirmados.
      // La cancelación explícita (o el lifecycle del prefijo tmp/) limpia S3.
      return { ...result, total, offset, limit, done };
    }

    const rows = this.parseAndCheckLimits(file_buffer);
    return this.processRows(rows, upload_dto, store_id, 0, session_id);
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

  /** Valida las filas y aplica los ajustes válidos, con recibos durables por fila. */
  private async processRows(
    rows: Record<string, any>[],
    upload_dto: BulkAdjustmentUploadDto & { initial_load_ack?: boolean },
    store_id: number,
    row_offset: number,
    session_id?: string,
  ): Promise<BulkAdjustmentUploadResultDto> {
    const evaluation = await this.evaluateRows(
      rows,
      upload_dto,
      store_id,
      row_offset,
    );
    const { results, valid_items, applied_rows, new_rows } = evaluation;
    this.assertInitialLoadAck(evaluation.new_rows.length, upload_dto);

    // Una fila ya confirmada gana sobre el estado ACTUAL del catálogo/stock:
    // reintentar no debe revertir ventas, renombres u otros ajustes posteriores.
    const committed = new Map<number, BulkAdjustmentItemResultDto>();
    if (session_id) {
      const receipts = await this.prisma.audit_logs.findMany({
        where: {
          store_id,
          organization_id: RequestContextService.getOrganizationId(),
          resource: this.sessionResource(session_id),
          action: 'bulk_inventory.row_committed',
          request_id: {
            in: results.map((row) =>
              this.rowRequestId(session_id, row.row_number),
            ),
          },
        },
        select: { new_values: true },
      });
      for (const receipt of receipts) {
        const row =
          receipt.new_values as unknown as BulkAdjustmentItemResultDto;
        committed.set(row.row_number, row);
      }
      for (const row of results) {
        const previous = committed.get(row.row_number);
        if (previous) Object.assign(row, previous);
      }
    }

    if (!session_id && valid_items.length > 0) {
      const outcomes =
        await this.adjustmentsService.batchCreateAndCompleteSettled(
          upload_dto.location_id,
          valid_items,
          { initialLoadFallback: true },
        );
      for (const outcome of outcomes) {
        if (outcome.ok) {
          if (outcome.adjustment?.adjustment_type) {
            this.reflectCommittedAdjustment(
              applied_rows[outcome.index],
              outcome.adjustment,
              valid_items[outcome.index].type,
            );
          }
          continue;
        }
        const row = applied_rows[outcome.index];
        if (!row) continue;
        row.status = 'error';
        row.message = `Error al aplicar ajuste: ${outcome.error?.message ?? 'desconocido'}`;
      }
    } else if (session_id) {
      for (let index = 0; index < valid_items.length; index++) {
        const row = applied_rows[index];
        if (committed.has(row.row_number)) continue;
        await this.commitSessionRow(session_id, row, store_id, async (tx) => {
          const result =
            await this.adjustmentsService.createAdjustmentInTransaction(
              tx,
              {
                ...valid_items[index],
                type: valid_items[index].type as AdjustmentType,
                location_id: upload_dto.location_id,
              },
              {
                approvedByUserId:
                  RequestContextService.getUserId() ?? undefined,
                initialLoadFallback: true,
              },
            );
          const committedRow = { ...row, action: 'adjusted' as const };
          this.reflectCommittedAdjustment(
            committedRow,
            result.adjustment,
            valid_items[index].type,
          );
          return { row: committedRow, adjustment: result };
        });
      }
    }

    // Producto + stock/costeo + recibo se confirman en UNA transacción por fila.
    // Una caída antes del ajuste ya no deja un producto huérfano que se duplique.
    for (const nr of new_rows) {
      if (committed.has(nr.row_number)) continue;
      await this.commitSessionRow(
        session_id,
        nr.result_row,
        store_id,
        async (tx) => {
          // El generador toma max(SKU)+1; serializar también filas DIFERENTES
          // evita que dos sesiones de la misma tienda elijan el mismo CI-… .
          await tx.$executeRawUnsafe(
            'SELECT pg_advisory_xact_lock(hashtext($1))',
            `inventory-bulk-sku:${store_id}`,
          );
          const sku = await this.skuGenerator.next(store_id, tx);
          const slug = await this.uniqueSlug(tx, nr.name, sku);
          const product = await tx.products.create({
            data: {
              store_id,
              name: nr.name,
              slug,
              sku,
              base_price: nr.base_price ?? 0,
              cost_price: nr.unit_cost,
              product_type: 'physical',
              state: 'active',
              track_inventory: true,
              stock_quantity: 0,
              updated_at: new Date(),
            },
            select: { id: true },
          });
          const adjustment =
            nr.quantity > 0
              ? await this.adjustmentsService.createAdjustmentInTransaction(
                  tx,
                  {
                    product_id: product.id,
                    location_id: upload_dto.location_id,
                    type: 'initial_load',
                    quantity_after: nr.quantity,
                    ...(nr.unit_cost !== null
                      ? { unit_cost: nr.unit_cost }
                      : {}),
                    description: nr.description,
                  },
                  {
                    approvedByUserId:
                      RequestContextService.getUserId() ?? undefined,
                  },
                )
              : undefined;
          return {
            row: {
              ...nr.result_row,
              sku,
              action: 'created',
              message: `Producto creado con SKU ${sku} (${nr.quantity > 0 ? 'carga inicial' : 'sin stock inicial'})`,
            },
            adjustment,
          };
        },
      );
    }

    if (session_id) {
      const handled = new Set(
        [...applied_rows, ...new_rows.map((nr) => nr.result_row)].map(
          (row) => row.row_number,
        ),
      );
      for (const row of results) {
        if (
          row.status !== 'success' ||
          handled.has(row.row_number) ||
          committed.has(row.row_number)
        )
          continue;
        await this.commitSessionRow(session_id, row, store_id, async () => ({
          row: { ...row },
        }));
      }
    }

    const failed = results.filter((row) => row.status === 'error').length;
    return {
      success: failed === 0,
      total_processed: rows.length,
      successful: results.length - failed,
      failed,
      results,
    };
  }

  private reflectCommittedAdjustment(
    row: BulkAdjustmentItemResultDto,
    adjustment: {
      adjustment_type: string;
      quantity_before: number;
      quantity_after: number;
      quantity_change: number;
    },
    requestedType: string,
  ): void {
    if (adjustment.quantity_before === undefined) return;
    if (
      requestedType === 'initial_load' &&
      adjustment.adjustment_type !== 'initial_load'
    ) {
      row.warnings = [
        ...(row.warnings ?? []),
        'El stock cambió desde el análisis: la carga inicial se convirtió en diferencia de conteo.',
      ];
    }
    row.quantity_before = adjustment.quantity_before;
    row.quantity_after = adjustment.quantity_after;
    row.quantity_change = adjustment.quantity_change;
  }

  private rowRequestId(session_id: string, row_number: number): string {
    return `bulk-adjustments:${session_id}:${row_number}`;
  }

  private sessionResource(session_id: string): string {
    // Reutiliza el índice existente (resource, resource_id, created_at).
    return `bulk_inventory_session:${session_id}`;
  }

  /** audit_logs no es auto-scoped: scope explícito al leer Y escribir. */
  private async commitSessionRow(
    session_id: string | undefined,
    row: BulkAdjustmentItemResultDto,
    store_id: number,
    apply: (tx: any) => Promise<{
      row: BulkAdjustmentItemResultDto;
      adjustment?: AdjustmentTransactionResult;
    }>,
  ): Promise<void> {
    const organization_id = RequestContextService.getOrganizationId();
    const user_id = RequestContextService.getUserId() ?? null;
    const request_id = session_id
      ? this.rowRequestId(session_id, row.row_number)
      : undefined;
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          if (request_id) {
            await tx.$executeRawUnsafe(
              'SELECT pg_advisory_xact_lock(hashtext($1))',
              `${store_id}:${request_id}`,
            );
            const previous = await tx.audit_logs.findFirst({
              where: {
                store_id,
                organization_id,
                request_id,
                resource: this.sessionResource(session_id!),
                resource_id: row.row_number,
                action: 'bulk_inventory.row_committed',
              },
              select: { new_values: true },
            });
            if (previous)
              return {
                row: previous.new_values as unknown as BulkAdjustmentItemResultDto,
              };
          }
          const applied = await apply(tx);
          if (request_id) {
            await tx.audit_logs.create({
              data: {
                store_id,
                organization_id,
                user_id,
                request_id,
                resource: this.sessionResource(session_id!),
                action: 'bulk_inventory.row_committed',
                resource_id: row.row_number,
                metadata: {
                  adjustment_id: applied.adjustment?.adjustment.id ?? null,
                },
                new_values: applied.row as unknown as Record<string, unknown>,
              },
            });
          }
          return applied;
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
      Object.assign(row, result.row);
      if (result.adjustment && organization_id) {
        this.adjustmentsService.emitInventoryAdjusted(
          result.adjustment,
          organization_id,
          user_id,
        );
      }
    } catch (error) {
      row.status = 'error';
      row.message = `Error al aplicar fila: ${error?.message ?? 'desconocido'}`;
    }
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
    valid_items: BatchAdjustmentInput[];
    applied_rows: BulkAdjustmentItemResultDto[];
    new_rows: NewProductRow[];
    successful: number;
    failed: number;
  }> {
    const results: BulkAdjustmentItemResultDto[] = [];
    const valid_items: BatchAdjustmentInput[] = [];
    const applied_rows: BulkAdjustmentItemResultDto[] = [];
    const new_rows: NewProductRow[] = [];
    const seen_skus = new Set<string>();
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
          cost_price: true,
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
          cost_price: true,
          products: {
            select: { name: true, track_inventory: true, cost_price: true },
          },
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

    const newNames = Array.from(
      new Set(
        rows
          .filter((row) => !row.sku?.toString().trim())
          .map((row) => row.name?.toString().trim())
          .filter((name): name is string => !!name),
      ),
    );
    const existingNames = new Set<string>();
    for (const names of this.chunk(newNames, LOOKUP_CHUNK)) {
      const products = await this.prisma.products.findMany({
        where: {
          store_id,
          state: { not: 'archived' },
          OR: names.map((name) => ({
            name: { equals: name, mode: 'insensitive' as const },
          })),
        },
        select: { name: true },
      });
      for (const product of products)
        existingNames.add(product.name.trim().toLocaleLowerCase());
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const row_number = row.__row_number ?? row_offset + i + 2; // +2 porque la fila 1 es header y el índice empieza en 0

      const sku: string = row.sku?.toString().trim() ?? '';
      const name: string = row.name?.toString().trim() ?? '';

      if (!sku && !name) {
        results.push({
          row_number,
          sku: '',
          status: 'error',
          message:
            'SKU vacío o no proporcionado; para crear un producto nuevo agrega el Nombre Producto',
        });
        failed++;
        continue;
      }

      if (sku) {
        if (seen_skus.has(sku)) {
          results.push({
            row_number,
            sku,
            status: 'error',
            message: `SKU duplicado en el archivo: "${sku}" ya aparece en una fila anterior`,
          });
          failed++;
          continue;
        }
        seen_skus.add(sku);
      }

      // Validar que quantity_after sea un número válido >= 0
      const quantity_after = Number(row.quantity_after);
      if (!Number.isFinite(quantity_after) || quantity_after < 0) {
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
      let fallbackCost = 0;

      const product = sku ? products_by_sku.get(sku) : undefined;

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
        fallbackCost = Number(product.cost_price ?? 0);
      } else {
        const variant = sku ? variants_by_sku.get(sku) : undefined;

        if (!variant) {
          // Un SKU escrito es una referencia, nunca permiso para dar de alta.
          // Evita duplicar catálogo por errores tipográficos o un SKU renombrado.
          if (sku || !name) {
            results.push({
              row_number,
              sku,
              status: 'error',
              message: `Producto con SKU "${sku}" no encontrado; verifica el SKU. Para crear un producto nuevo deja el SKU vacío y agrega el Nombre Producto`,
            });
            failed++;
            continue;
          }

          const base_price = this.parseOptionalMoney(row.base_price);
          const unit_cost = this.parseOptionalMoney(row.unit_cost);
          if (base_price === 'invalid' || unit_cost === 'invalid') {
            results.push({
              row_number,
              sku,
              product_name: name,
              status: 'error',
              message: `${base_price === 'invalid' ? 'Precio Venta' : 'Precio Compra'} inválido: debe ser un monto >= 0`,
            });
            failed++;
            continue;
          }

          const floor_qty = Math.floor(quantity_after);
          const result_row: BulkAdjustmentItemResultDto = {
            row_number,
            sku,
            product_name: name,
            status: 'success',
            message: 'Producto nuevo (se creará con SKU automático)',
            warnings: [
              ...((unit_cost ?? 0) <= 0
                ? [
                    'Sin costo de compra: el inventario inicial quedará valorado en 0.',
                  ]
                : []),
              ...(existingNames.has(name.toLocaleLowerCase())
                ? [
                    'Ya existe un producto con este nombre; revisa su SKU para evitar duplicados.',
                  ]
                : []),
            ],
            quantity_before: 0,
            quantity_after: floor_qty,
            quantity_change: floor_qty,
            action: 'created',
          };
          results.push(result_row);
          new_rows.push({
            row_number,
            sku: sku || null,
            auto_sku: !sku,
            name,
            quantity: floor_qty,
            base_price,
            unit_cost,
            description:
              row.description?.toString().trim() ||
              upload_dto.description ||
              'Carga inicial (ajuste masivo)',
            result_row,
          });
          successful++;
          continue;
        }
        product_id = variant.product_id;
        product_variant_id = variant.id;
        product_name = variant.name
          ? `${variant.products.name} - ${variant.name}`
          : variant.products.name;
        track_inventory =
          variant.track_inventory_override ?? variant.products.track_inventory;
        fallbackCost =
          Number(variant.cost_price ?? 0) > 0
            ? Number(variant.cost_price)
            : Number(variant.products.cost_price ?? 0);
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
          ...((this.normalizeAdjustmentType(row.type) ||
            upload_dto.adjustment_type) === 'initial_load'
            ? {
                warnings: [
                  'Carga inicial no aplicable: se usará diferencia de conteo porque requiere cantidad actual 0 y una entrada positiva.',
                ],
              }
            : {}),
        });
        successful++;
        continue;
      }

      // Determinar tipo de ajuste: por fila o global
      const row_type = this.normalizeAdjustmentType(row.type);
      let adjustment_type =
        row_type || upload_dto.adjustment_type || 'count_variance';
      const warnings: string[] = [];
      if (
        adjustment_type === 'initial_load' &&
        (quantity_before !== 0 || quantity_after <= quantity_before)
      ) {
        adjustment_type = 'count_variance';
        warnings.push(
          'Carga inicial no aplicable: se usará diferencia de conteo porque requiere cantidad actual 0 y una entrada positiva.',
        );
      }
      const stockKey = `${product_id}:${product_variant_id ?? 'null'}`;
      if (!stock_by_key.has(stockKey) && quantity_after > 0) {
        adjustment_type = 'initial_load';
        warnings.push(
          'No existe stock en esta bodega: la entrada se registrará como carga inicial.',
        );
      }
      const unit_cost =
        adjustment_type === 'initial_load'
          ? this.parseOptionalMoney(row.unit_cost)
          : null;
      if (unit_cost === 'invalid') {
        results.push({
          row_number,
          sku,
          product_name,
          status: 'error',
          message: 'Precio Compra inválido: debe ser un monto >= 0',
        });
        failed++;
        continue;
      }
      if (
        adjustment_type === 'initial_load' &&
        (unit_cost ?? fallbackCost) <= 0
      ) {
        warnings.push(
          'Sin costo de compra: el inventario inicial quedará valorado en 0.',
        );
      }

      const description =
        row.description?.toString().trim() ||
        upload_dto.description ||
        'Ajuste masivo de inventario';

      valid_items.push({
        product_id,
        ...(product_variant_id ? { product_variant_id } : {}),
        type: adjustment_type,
        ...(unit_cost !== null ? { unit_cost } : {}),
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
        warnings,
      };
      results.push(result_row);
      applied_rows.push(result_row);
      successful++;
    }

    return {
      results,
      valid_items,
      applied_rows,
      new_rows,
      successful,
      failed,
    };
  }

  /** `null` = vacío; 'invalid' = no numérico o negativo. */
  private parseOptionalMoney(raw: unknown): number | null | 'invalid' {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return null;
    }
    const n = parseMoneyCell(raw);
    if (n === null || n < 0) return 'invalid';
    return n;
  }

  private assertInitialLoadAck(
    new_count: number,
    upload_dto: { initial_load_ack?: boolean },
  ): void {
    if (new_count > 0 && upload_dto.initial_load_ack !== true) {
      throw new VendixHttpException(
        ErrorCodes.INV_ADJ_BULK_INITIAL_LOAD_ACK_001,
        undefined,
        { new_products: new_count },
      );
    }
  }

  private async uniqueSlug(
    tx: any,
    name: string,
    sku: string,
  ): Promise<string> {
    const base = generateSlug(name) || generateSlug(sku) || 'producto';
    const taken = async (slug: string) =>
      !!(await tx.products.findFirst({
        where: { slug, state: { not: 'archived' } },
        select: { id: true },
      }));
    if (!(await taken(base))) return base;
    const with_sku = `${base}-${generateSlug(sku)}`;
    if (!(await taken(with_sku))) return with_sku;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${with_sku}-${n}`;
      if (!(await taken(candidate))) return candidate;
    }
    return `${with_sku}-${Date.now()}`;
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

        const row: Record<string, any> = { __row_number: i + 1 };
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

        if (has_data) {
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
      initial_load: 'initial_load',
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
      'carga inicial': 'initial_load',
    };

    return type_map[normalized] || null;
  }
}
