import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CreateAdjustmentDto,
  AdjustmentQueryDto,
  InventoryAdjustment,
  AdjustmentResponse,
  AdjustmentType,
} from './interfaces/inventory-adjustment.interface';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';

/** Una línea de un ajuste por lote (conteo, carga masiva, reconteo por IA). */
export interface BatchAdjustmentInput {
  product_id: number;
  product_variant_id?: number;
  batch_id?: number;
  type: string;
  quantity_after: number;
  reason_code?: string;
  description?: string;
}

/**
 * Resultado POR ÍTEM de un lote. El lote no es atómico, así que el llamador
 * necesita saber exactamente qué se aplicó para no reportar como fallida una
 * fila cuyo stock ya se movió.
 */
/**
 * Lo que devuelve un ajuste creado DENTRO de una transacción ajena. Lleva el
 * `cost_amount` porque el evento contable se emite después del commit y el
 * llamador lo necesita para decidir si hay algo que anunciar.
 */
export interface AdjustmentTransactionResult {
  adjustment: InventoryAdjustment;
  quantity_change: number;
  cost_amount: number;
}

export type BatchAdjustmentOutcome =
  | { index: number; ok: true; adjustment: InventoryAdjustment }
  | { index: number; ok: false; error: any };

// Common include object for adjustment queries
const ADJUSTMENT_INCLUDE = {
  products: {
    select: {
      id: true,
      name: true,
      sku: true,
    },
  },
  product_variants: {
    select: {
      id: true,
      sku: true,
      name: true,
    },
  },
  inventory_locations: {
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      store_id: true,
    },
  },
  inventory_batches: {
    select: {
      id: true,
      batch_number: true,
      expiration_date: true,
      quantity: true,
      quantity_used: true,
    },
  },
  organizations: {
    select: {
      id: true,
      name: true,
    },
  },
  users_inventory_adjustments_created_by_user_idTousers: {
    select: {
      id: true,
      username: true,
      email: true,
    },
  },
  users_inventory_adjustments_approved_by_user_idTousers: {
    select: {
      id: true,
      username: true,
      email: true,
    },
  },
};

@Injectable()
export class InventoryAdjustmentsService {
  private readonly logger = new Logger(InventoryAdjustmentsService.name);

  constructor(
    private prisma: StorePrismaService,
    private stockLevelManager: StockLevelManager,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Crea un ajuste de inventario
   * Soporta ajuste a nivel de bodega o a nivel de lote específico
   *
   * `options.approvedByUserId` sólo lo usan los flujos internos que crean y
   * aprueban en un paso (conteo por lote). No viaja en el DTO: que el cliente
   * declarara el aprobador era el defecto, y `organization_id` /
   * `created_by_user_id` se resuelven del contexto.
   */
  async createAdjustment(
    data: CreateAdjustmentDto,
    options: { approvedByUserId?: number } = {},
  ): Promise<InventoryAdjustment> {
    const { organizationId, userId } = this.resolveAdjustmentActor();

    // `timeout` explícito: ahora la transacción cubre también el movimiento de
    // stock, el espejo denormalizado y el snapshot de valoración, que antes
    // corrían fuera. Los 5 s por defecto de Prisma se quedan cortos en un
    // producto con muchas ubicaciones o variantes.
    const adjustment_result = await this.prisma.$transaction(
      (prisma) => this.createAdjustmentInTransaction(prisma, data, options),
      { timeout: 30_000, maxWait: 10_000 },
    );

    this.emitInventoryAdjusted(adjustment_result, organizationId, userId);

    return adjustment_result.adjustment;
  }

  /**
   * Resuelve organización y usuario del contexto de petición. Extraído para que
   * el llamador que abre SU PROPIA transacción los tenga ANTES de abrirla: el
   * evento contable se emite después del commit y necesita los dos.
   */
  private resolveAdjustmentActor(): {
    organizationId: number;
    userId: number | null;
  } {
    const orgIdRaw = RequestContextService.getOrganizationId();
    const userIdRaw = RequestContextService.getUserId();

    if (!orgIdRaw) {
      throw new VendixHttpException(ErrorCodes.INV_CONTEXT_001);
    }

    const organizationId = Number(orgIdRaw);
    const userId = userIdRaw ? Number(userIdRaw) : null;

    if (isNaN(organizationId)) {
      throw new BadRequestException('Invalid organization ID in context');
    }

    return { organizationId, userId };
  }

  /**
   * EL MISMO ajuste, pero DENTRO de la transacción del llamador.
   *
   * Existe por CP-PURCHASE-TRANSPARENCY D.4: archivar un producto con
   * existencias tiene que dar de baja el stock Y escribir `state='archived'` Y
   * dejar su fila de auditoría en UN solo comprobante. Con `createAdjustment`
   * eso era imposible: abre su propia transacción, y anidar
   * `$transaction` dentro de otra en Prisma no anida — toma OTRA conexión del
   * pool, que ni ve lo escrito por la transacción exterior ni revierte con ella
   * (ver `reference_prisma_pool_starvation_this_prisma_in_tx`).
   *
   * NO emite el evento contable: el llamador es el dueño del commit, así que es
   * el único que sabe cuándo emitirlo sin anunciar un hecho que puede
   * revertirse. Usa {@link emitInventoryAdjusted} después del commit.
   */
  async createAdjustmentInTransaction(
    prismaTx: any,
    data: CreateAdjustmentDto,
    options: { approvedByUserId?: number } = {},
  ): Promise<AdjustmentTransactionResult> {
    const { organizationId, userId } = this.resolveAdjustmentActor();

    // `prisma` es el handle de la transacción del llamador: todas las lecturas
    // y escrituras de aquí abajo viajan en ESE comprobante.
    const prisma = prismaTx;

    // Ensure IDs are numbers (handling string payload from frontend)
    const productId = Number(data.product_id);
    const locationId = Number(data.location_id);
    const variantId = data.product_variant_id
      ? Number(data.product_variant_id)
      : null;
    const batchId = data.batch_id ? Number(data.batch_id) : null;
    const quantityAfter = Number(data.quantity_after);

    // 1. Validar que el adjustment_type sea válido
    const validTypes: AdjustmentType[] = [
      'damage',
      'loss',
      'theft',
      'expiration',
      'count_variance',
      'manual_correction',
    ];
    if (!validTypes.includes(data.type)) {
      throw new BadRequestException(`Invalid adjustment type: ${data.type}`);
    }

    let quantityBefore: number;
    let quantityChange: number;

    // 2. Determinar la cantidad actual según si es ajuste de lote o de stock general
    if (batchId) {
      // Ajuste a nivel de LOTE
      const batch = await prisma.inventory_batches.findUnique({
        where: { id: batchId },
      });

      if (!batch) {
        throw new VendixHttpException(ErrorCodes.INV_ADJ_001);
      }

      if (batch.product_id !== productId) {
        throw new VendixHttpException(ErrorCodes.INV_VALIDATE_001);
      }

      if (batch.location_id !== locationId) {
        throw new VendixHttpException(ErrorCodes.INV_VALIDATE_001);
      }

      // Cantidad actual del lote (quantity - quantity_used)
      quantityBefore = batch.quantity - batch.quantity_used;
      quantityChange = quantityAfter - quantityBefore;

      // Actualizar el lote
      const newQuantity = batch.quantity + quantityChange;
      if (newQuantity < batch.quantity_used) {
        throw new BadRequestException(
          'Cannot reduce batch quantity below used amount',
        );
      }

      await prisma.inventory_batches.update({
        where: { id: batchId },
        data: {
          quantity: newQuantity,
          updated_at: new Date(),
        },
      });
    } else {
      // Ajuste a nivel de STOCK GENERAL (bodega)
      // Usamos findFirst porque el índice único incluye product_variant_id que es nullable
      const currentStockLevel = await prisma.stock_levels.findFirst({
        where: {
          product_id: productId,
          product_variant_id: variantId, // null se maneja correctamente con findFirst
          location_id: locationId,
        },
      });

      if (!currentStockLevel) {
        throw new VendixHttpException(ErrorCodes.INV_FIND_001);
      }

      quantityBefore = currentStockLevel.quantity_on_hand;
      quantityChange = quantityAfter - quantityBefore;
    }

    // 3. Crear registro de ajuste
    const adjustment = await prisma.inventory_adjustments.create({
      data: {
        organization_id: organizationId,
        product_id: productId,
        product_variant_id: variantId,
        location_id: locationId,
        batch_id: batchId,
        adjustment_type: data.type as any,
        quantity_before: quantityBefore,
        quantity_after: quantityAfter,
        quantity_change: quantityChange,
        reason_code: data.reason_code || null,
        description: data.description || null,
        created_by_user_id: userId ?? null,
        approved_by_user_id: options.approvedByUserId ?? null,
        approved_at: options.approvedByUserId ? new Date() : null,
        created_at: new Date(),
      },
      include: ADJUSTMENT_INCLUDE,
    });

    // 4. Actualizar stock levels (siempre, tanto para lote como para stock general)
    //
    // El `prisma` del segundo argumento NO es cosmético. Esta llamada iba SIN
    // handle: `updateStock` abría entonces `this.prisma.$transaction` por su
    // cuenta, así que la fila de `inventory_adjustments` y el movimiento de
    // stock que la justifica vivían en DOS transacciones distintas. Si el
    // ajuste fallaba después, la fila revertía y el stock ya movido se quedaba
    // movido; y cada ajuste consumía dos conexiones del pool a la vez. Pasarle
    // el handle mete las dos escrituras en el mismo comprobante, que es lo que
    // el código siempre pareció hacer.
    const stockUpdate = await this.stockLevelManager.updateStock(
      {
        product_id: productId,
        variant_id: variantId ?? undefined,
        location_id: locationId,
        quantity_change: quantityChange,
        movement_type: 'adjustment',
        reason: `Adjustment: ${data.type}${batchId ? ` (Batch ID: ${batchId})` : ''} - ${data.description || 'No description'}`,
        user_id: userId || undefined,
        create_movement: true,
        validate_availability: false,
      },
      prisma,
    );

    // 5. Transformar respuesta para mapear nombres de relaciones
    return {
      adjustment: this.mapAdjustmentResponse(adjustment),
      quantity_change: quantityChange,
      cost_amount: Number(stockUpdate.cost_snapshot?.total_cost || 0),
    };
  }

  /**
   * Anuncia el ajuste a la contabilidad. SIEMPRE después del commit.
   *
   * LA COMPUERTA `cost_amount > 0` NO ES UN DESCUIDO Y TAMPOCO ES INOCUA.
   * Un asiento por valor cero no es un asiento, así que emitirlo sólo
   * ensuciaría el libro. Pero la consecuencia hay que decirla en voz alta: el
   * 63,9 % de las unidades fantasma medidas en desarrollo (1.122.249 de
   * 1.756.346) tienen costo efectivo CERO tras agotar la cadena canónica
   * completa —`stock_levels.cost_per_unit` → `product_variants.cost_price` →
   * `products.cost_price`—, así que la mayoría de los castigos de D.4 no
   * producirá asiento. Por eso el rastro de esas bajas NO puede depender de
   * este evento: la fila de `audit_logs` que D.8 escribe DENTRO de la
   * transacción lleva las unidades, el costo unitario resuelto y el valor de
   * cada línea, y marca explícitamente cuáles se destruyeron sin valor
   * conocido. Valor cero ahí significa «costo desconocido», no «mercancía
   * gratis».
   */
  emitInventoryAdjusted(
    result: AdjustmentTransactionResult,
    organizationId: number,
    userId: number | null,
  ): void {
    try {
      const cost_amount = Math.abs(Number(result.cost_amount || 0));
      if (cost_amount > 0) {
        this.eventEmitter.emit('inventory.adjusted', {
          adjustment_id: result.adjustment.id,
          organization_id: organizationId,
          store_id: result.adjustment.inventory_locations?.store_id,
          quantity_change: result.quantity_change,
          cost_amount,
          user_id: userId,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to emit inventory.adjusted for adjustment #${result.adjustment.id}: ${error.message}`,
      );
    }
  }

  /**
   * Mapea la respuesta del ajuste para normalizar nombres de relaciones
   */
  private mapAdjustmentResponse(adjustment: any): InventoryAdjustment {
    const createdBy =
      adjustment.users_inventory_adjustments_created_by_user_idTousers;
    const approvedBy =
      adjustment.users_inventory_adjustments_approved_by_user_idTousers;

    return {
      ...adjustment,
      created_by_user: createdBy
        ? {
            id: createdBy.id,
            user_name: createdBy.username,
            email: createdBy.email,
          }
        : null,
      approved_by_user: approvedBy
        ? {
            id: approvedBy.id,
            user_name: approvedBy.username,
            email: approvedBy.email,
          }
        : null,
    };
  }

  /**
   * Crea múltiples ajustes de inventario en batch (como borrador, sin aprobar)
   */
  async batchCreateAdjustments(
    locationId: number,
    items: BatchAdjustmentInput[],
  ): Promise<InventoryAdjustment[]> {
    const results: InventoryAdjustment[] = [];
    for (const item of items) {
      const adjustment = await this.createAdjustment({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        location_id: locationId,
        batch_id: item.batch_id,
        type: item.type as AdjustmentType,
        quantity_after: item.quantity_after,
        reason_code: item.reason_code,
        description: item.description,
      });
      results.push(adjustment);
    }
    return results;
  }

  /**
   * Crea múltiples ajustes y los aprueba inmediatamente.
   *
   * Cada ítem abre su propia transacción (`createAdjustment`), así que este
   * lote NO es atómico: si el ítem N falla, los N−1 anteriores YA están
   * commiteados y su stock movido. Lanzar en el primer fallo conserva el
   * contrato histórico del endpoint, pero quien necesite saber qué se aplicó y
   * qué no debe usar `batchCreateAndCompleteSettled`.
   */
  async batchCreateAndComplete(
    locationId: number,
    items: BatchAdjustmentInput[],
  ): Promise<InventoryAdjustment[]> {
    const settled = await this.batchCreateAndCompleteSettled(locationId, items);
    const firstFailure = settled.find((entry) => !entry.ok);
    if (firstFailure && !firstFailure.ok) {
      throw firstFailure.error;
    }
    return settled
      .filter(
        (entry): entry is { index: number; ok: true; adjustment: InventoryAdjustment } =>
          entry.ok,
      )
      .map((entry) => entry.adjustment);
  }

  /**
   * Igual que `batchCreateAndComplete`, pero devuelve el resultado POR ÍTEM en
   * vez de abortar en el primero que falle.
   *
   * Existe porque la carga masiva por archivo tenía que marcar como fallidas
   * filas que en realidad ya se habían aplicado: al no saber dónde se rompió el
   * lote, su `catch` reescribía TODAS las filas exitosas a error y reportaba
   * "0 exitosos, 1000 con errores" con el stock ya movido.
   */
  async batchCreateAndCompleteSettled(
    locationId: number,
    items: BatchAdjustmentInput[],
  ): Promise<BatchAdjustmentOutcome[]> {
    const userIdRaw = RequestContextService.getUserId();
    const userId = userIdRaw ? Number(userIdRaw) : null;
    const outcomes: BatchAdjustmentOutcome[] = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      try {
        const adjustment = await this.createAdjustment(
          {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            location_id: locationId,
            batch_id: item.batch_id,
            type: item.type as AdjustmentType,
            quantity_after: item.quantity_after,
            reason_code: item.reason_code,
            description: item.description,
          },
          { approvedByUserId: userId ?? undefined },
        );
        outcomes.push({ index, ok: true, adjustment });
      } catch (error) {
        this.logger.error(
          `Ajuste masivo: falló el ítem ${index} (producto ${item.product_id}): ${error?.message}`,
        );
        outcomes.push({ index, ok: false, error });
      }
    }

    return outcomes;
  }

  /**
   * Aprueba un ajuste de inventario
   */
  /**
   * Visa un ajuste dejando constancia de QUIÉN lo aprobó.
   *
   * El aprobador se resuelve del contexto de la petición, no del body. Antes
   * llegaba por `@Body('approvedByUserId')` mientras el frontend enviaba
   * `approved_by_user_id` (y con el valor `0` literal): el nombre no coincidía,
   * Prisma omitía el campo `undefined` y la columna quedaba en NULL con
   * `approved_at` sellado. Tres daños encadenados: se perdía la traza de
   * auditoría de una merma —el dato que busca un contador—, el guard de
   * doble-aprobación de más abajo nunca disparaba (se podía re-estampar
   * `approved_at` indefinidamente por API), y el filtro `status` clasifica por
   * esta columna, así que TODO ajuste aprobado seguía contando como pendiente.
   * Quién aprueba es identidad, no un parámetro que el cliente pueda declarar.
   */
  /**
   * `approverUserId` sólo lo llenan llamadores internos que ya resolvieron el
   * usuario del lado del servidor (p. ej. el flujo de organización). Nunca
   * viene del body: que el cliente declare quién aprueba era el defecto.
   */
  async approveAdjustment(
    adjustmentId: number,
    approverUserId?: number,
  ): Promise<InventoryAdjustment> {
    const adjustment = await this.prisma.inventory_adjustments.findUnique({
      where: { id: adjustmentId },
    });

    if (!adjustment) {
      throw new VendixHttpException(ErrorCodes.INV_ADJ_001);
    }

    // Se mira también `approved_at` porque es la señal que la UI ya usa para
    // pintar el badge "Aprobado", y las filas históricas la tienen sellada con
    // el aprobador en NULL.
    if (adjustment.approved_by_user_id || adjustment.approved_at) {
      throw new ConflictException('Adjustment already approved');
    }

    const userIdRaw = RequestContextService.getUserId();
    const approvedByUserId =
      approverUserId ?? (userIdRaw ? Number(userIdRaw) : null);

    const updated = await this.prisma.inventory_adjustments.update({
      where: { id: adjustmentId },
      data: {
        approved_by_user_id: approvedByUserId,
        approved_at: new Date(),
      },
      include: ADJUSTMENT_INCLUDE,
    });

    return this.mapAdjustmentResponse(updated);
  }

  /**
   * Obtiene ajustes con filtros
   */
  async getAdjustments(query: AdjustmentQueryDto): Promise<AdjustmentResponse> {
    // El frontend manda snake_case; los alias camelCase quedan por
    // compatibilidad. Leer sólo una de las dos formas era el motivo de que
    // TODOS los filtros se cayeran en silencio.
    const organizationId = query.organization_id ?? query.organizationId;
    const productId = query.product_id ?? query.productId;
    const variantId = query.variant_id ?? query.variantId;
    const locationId = query.location_id ?? query.locationId;
    const batchId = query.batch_id ?? query.batchId;
    const createdByUserId = query.created_by_user_id ?? query.createdByUserId;
    const startDate = query.start_date ?? query.startDate;
    const endDate = query.end_date ?? query.endDate;
    const search = query.search?.trim();

    // El rango de fechas va en UN solo objeto: dos spreads sobre la misma clave
    // `created_at` hacían que el segundo borrara al primero, así que pedir
    // desde+hasta filtraba sólo por "hasta".
    const createdAtRange: { gte?: Date; lte?: Date } = {};
    if (startDate) createdAtRange.gte = new Date(startDate);
    if (endDate) createdAtRange.lte = new Date(endDate);

    const where: any = {
      ...(organizationId && { organization_id: organizationId }),
      ...(productId && { product_id: productId }),
      ...(variantId && { product_variant_id: variantId }),
      ...(locationId && { location_id: locationId }),
      ...(batchId && { batch_id: batchId }),
      ...(query.type && { adjustment_type: query.type }),
      // El estado se deriva de `approved_at`, no de `approved_by_user_id`: es la
      // señal que la UI ya usa para el badge "Aprobado", y las filas aprobadas
      // antes del fix del aprobador tienen la fecha sellada con el usuario en
      // NULL — con el predicado viejo seguían apareciendo como pendientes.
      ...(query.status && {
        approved_at: query.status === 'approved' ? { not: null } : null,
      }),
      ...(createdByUserId && {
        created_by_user_id: createdByUserId,
      }),
      ...(Object.keys(createdAtRange).length > 0 && {
        created_at: createdAtRange,
      }),
      // La búsqueda vivía sólo en el cliente y por eso miraba nada más las 10
      // filas de la página visible.
      ...(search && {
        OR: [
          { description: { contains: search, mode: 'insensitive' } },
          { reason_code: { contains: search, mode: 'insensitive' } },
          { products: { name: { contains: search, mode: 'insensitive' } } },
          { products: { sku: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const offset = Number(query.offset) || 0;

    const [adjustments, total, byType] = await Promise.all([
      this.prisma.inventory_adjustments.findMany({
        where,
        include: ADJUSTMENT_INCLUDE,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: Number(query.limit) || 50,
      }),
      this.prisma.inventory_adjustments.count({ where }),
      // Conteo por tipo sobre el filtro COMPLETO, no sobre la página: las
      // tarjetas de arriba contaban las 10 filas visibles.
      this.prisma.inventory_adjustments.groupBy({
        by: ['adjustment_type'],
        where,
        _count: { _all: true },
      }),
    ]);

    const countOf = (type: AdjustmentType): number =>
      Number(
        (byType as any[]).find((row) => row.adjustment_type === type)?._count
          ?._all ?? 0,
      );

    return {
      adjustments: adjustments.map((a) => this.mapAdjustmentResponse(a)),
      total,
      hasMore: offset + adjustments.length < total,
      stats: {
        total,
        losses: countOf('loss'),
        damages: countOf('damage'),
        corrections: countOf('manual_correction'),
      },
    };
  }

  /**
   * Obtiene un ajuste por ID con información completa
   */
  async getAdjustmentById(id: number): Promise<InventoryAdjustment> {
    const adjustment = await this.prisma.inventory_adjustments.findUnique({
      where: { id },
      include: ADJUSTMENT_INCLUDE,
    });

    if (!adjustment) {
      throw new VendixHttpException(ErrorCodes.INV_ADJ_001);
    }

    return this.mapAdjustmentResponse(adjustment);
  }

  /**
   * Obtiene resumen de ajustes por tipo
   */
  async getAdjustmentSummary(
    organizationId: number,
    startDate?: Date,
    endDate?: Date,
  ): Promise<any> {
    const where = {
      organization_id: organizationId,
      ...(startDate &&
        endDate && {
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        }),
    };

    const summary = await this.prisma.inventory_adjustments.groupBy({
      by: ['adjustment_type'],
      where,
      _sum: {
        quantity_change: true,
      },
      _count: {
        id: true,
      },
    });

    return summary.map((item) => ({
      type: item.adjustment_type,
      totalQuantity: Math.abs(item._sum.quantity_change || 0),
      adjustmentCount: item._count.id,
    }));
  }

  /**
   * Busca productos con stock en una ubicación para ajustes
   */
  async searchAdjustableProducts(
    search: string,
    locationId: number,
    limit = 10,
  ) {
    const stockLevels = await this.prisma.stock_levels.findMany({
      where: {
        location_id: locationId,
        products: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
            { barcode: { contains: search, mode: 'insensitive' } },
          ],
        },
      },
      include: {
        products: {
          select: { id: true, name: true, sku: true },
        },
      },
      take: limit,
    });

    return stockLevels.map((sl) => ({
      id: sl.products.id,
      name: sl.products.name,
      sku: sl.products.sku,
      // Aditivo: expone la variante real de esta fila de stock_levels para
      // que consumidores conscientes de variantes (picker manual del
      // escáner de reconteo IA) puedan propagar product_variant_id al crear
      // el ajuste. Consumidores que ignoran el campo no se ven afectados.
      product_variant_id: sl.product_variant_id,
      stock_at_location: {
        quantity_on_hand: sl.quantity_on_hand,
        quantity_reserved: sl.quantity_reserved,
        quantity_available: sl.quantity_available,
      },
    }));
  }

  /**
   * Libera todas las reservas activas de un producto
   */
  async releaseReservationsByProduct(
    product_id: number,
    product_variant_id?: number,
  ): Promise<{ released_count: number; total_quantity: number }> {
    return this.stockLevelManager.releaseAllReservationsForProduct(
      product_id,
      product_variant_id,
    );
  }

  /**
   * Libera TODAS las reservas activas de la organización
   */
  async releaseAllReservations(): Promise<{
    released_count: number;
    total_quantity: number;
  }> {
    return this.stockLevelManager.releaseAllActiveReservations();
  }

  /**
   * Elimina un ajuste (solo si no está aprobado)
   */
  /**
   * Borra un ajuste REVIRTIENDO su efecto sobre el stock.
   *
   * `createAdjustment` aplica el stock siempre (la aprobación es sólo el sello
   * de auditoría), así que borrar la fila sin revertir dejaba el saldo movido y
   * SIN documento que lo explicara: un ajuste de 100 → 80 borrado dejaba −20
   * huérfanos para siempre. La reversión pasa por `updateStock` para que quede
   * su propio movimiento en el rastro, en vez de deshacer el histórico.
   */
  async deleteAdjustment(id: number): Promise<void> {
    const adjustment = await this.prisma.inventory_adjustments.findUnique({
      where: { id },
    });

    if (!adjustment) {
      throw new VendixHttpException(ErrorCodes.INV_ADJ_001);
    }

    // Se mira también `approved_at`: las filas aprobadas antes del fix del
    // aprobador tienen la fecha sellada con el usuario en NULL.
    if (adjustment.approved_by_user_id || adjustment.approved_at) {
      throw new ConflictException('Cannot delete approved adjustment');
    }

    const quantityChange = Number(adjustment.quantity_change ?? 0);

    await this.prisma.$transaction(async (tx) => {
      if (Number.isFinite(quantityChange) && quantityChange !== 0) {
        // Un ajuste de lote tocó `inventory_batches.quantity` además del saldo
        // de la bodega, así que hay que revertir las dos patas.
        if (adjustment.batch_id) {
          const batch = await tx.inventory_batches.findUnique({
            where: { id: adjustment.batch_id },
          });
          if (batch) {
            const restored = batch.quantity - quantityChange;
            if (restored < batch.quantity_used) {
              throw new ConflictException(
                `No se puede revertir el ajuste #${adjustment.id}: el lote ya consumió ${batch.quantity_used} unidad(es)`,
              );
            }
            await tx.inventory_batches.update({
              where: { id: batch.id },
              data: { quantity: restored, updated_at: new Date() },
            });
          }
        }

        await this.stockLevelManager.updateStock(
          {
            product_id: adjustment.product_id,
            variant_id: adjustment.product_variant_id ?? undefined,
            location_id: adjustment.location_id,
            quantity_change: -quantityChange,
            movement_type: 'adjustment',
            reason: `Reversión del ajuste #${adjustment.id}`,
            source_module: 'inventory_adjustment_delete',
            create_movement: true,
          },
          tx,
        );
      }

      await tx.inventory_adjustments.delete({
        where: { id },
      });
    });
  }
}
