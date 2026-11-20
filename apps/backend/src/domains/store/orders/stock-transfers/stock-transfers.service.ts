import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import {
  buildTokenAndFieldOr,
  isSearchAccentFolded,
  tokenizeInternal,
  type SearchTextFieldMap,
} from '../../../../common/utils/search-text.util';
import {
  rankedIdsPage,
  scoreTokens,
} from '../../../../common/utils/search-score.util';
import { PosSearchPathService } from '../../settings/pos-smart-search/pos-search-path.service';
import { Prisma } from '@prisma/client';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { TransferQueryDto } from './dto/transfer-query.dto';
import { transfer_status_enum } from '@prisma/client';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { recordTriggerEvent } from '../../workflows/engine/workflow-trigger.outbox';
import {
  assertStockAvailableAtOrigin,
  assertTransferLines,
  expandTransferablePickerRows,
  type TransferablePickerRow,
} from './transfer-item-rules';
import {
  accumulateTransferReceiptNoteInTx,
  appendTransferNote,
  buildDispatchPlan,
  cleanText,
  computeNoSupportAlert,
  createTransferNoteInTx,
  dispatchedQuantity,
  hasDeliveryDeadlinePassed,
  noSupportAlertNote,
  pendingQuantity,
  isNeverDispatched,
  requiresDispatchFirst,
  resolveLineBatch,
  resolveStoreSurfaceNoteStoreId,
  resolveTransferTransport,
} from './transfer-transport';
import {
  listTransferAdvancedOptions,
  listTransferBatches,
  listTransferLocationStockPage,
  lookupTransferCode,
} from './transfer-advanced-options';
import { DispatchTransferDto } from './dto/transfer-advanced.dto';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

/**
 * Estados que representan "creada, todavía sin aprobar".
 *
 * `pending` es el canónico —el que escribe `create()` y el `@default` de la
 * columna— y `draft` es su alias legacy, que el enum conserva marcado para
 * borrado diferido. Los guards aceptan ambos para que las filas históricas
 * sigan siendo operables; el espejo de organización hace lo mismo con
 * `normalizeStatusFilter`.
 */
const PENDING_LIKE_STATUSES: transfer_status_enum[] = [
  transfer_status_enum.pending,
  transfer_status_enum.draft,
];

/**
 * Estados terminales: ninguna operación mueve stock sobre ellos. `received` es
 * el que escribe el flujo de organización sobre esta misma tabla y
 * `closed_with_loss` es terminal desde P2.
 */
const TRANSFER_TERMINAL_STATUSES: transfer_status_enum[] = [
  transfer_status_enum.completed,
  transfer_status_enum.received,
  transfer_status_enum.closed_with_loss,
  transfer_status_enum.cancelled,
];

/**
 * D.2 — Set de recall del picker de traslados: PARIDAD con el OR legacy
 * (name/sku, raíz `products`, sin nest). El filtro `stock_levels.some`
 * @origen se conserva intacto en ambas ramas.
 */
const TRANSFERABLE_SEARCH_FIELDS: SearchTextFieldMap = {
  scalar: ['name', 'sku'],
};

/** D.2 — Scan-cap del picker (top-10; sobre el cap, legacy). */
const TRANSFERABLE_SEARCH_SCAN_CAP = 200;

interface TransferableSearchRow {
  id: number;
  name: string;
  sku: string | null;
  stock_levels: Array<{
    location_id: number;
    product_variant_id?: number | null;
    quantity_on_hand: unknown;
    quantity_reserved: unknown;
    quantity_available: unknown;
    product_variants?: {
      id: number;
      name: string | null;
      sku: string | null;
    } | null;
  }>;
}

/**
 * Columnas de `stock_levels` que el picker necesita: la variante viaja para que
 * cada variante sea una fila propia con su propio disponible (antes se tomaba
 * la primera fila de la ubicación, que en un producto con variantes era una
 * variante cualquiera, y el ítem salía sin `product_variant_id`).
 */
const TRANSFERABLE_STOCK_LEVEL_SELECT = {
  location_id: true,
  product_variant_id: true,
  quantity_on_hand: true,
  quantity_reserved: true,
  quantity_available: true,
  product_variants: { select: { id: true, name: true, sku: true } },
} as const;

/** Shape de respuesta de las escrituras del ciclo de despacho/recepción. */
const TRANSFER_FLOW_INCLUDE = {
  from_location: true,
  to_location: true,
  stock_transfer_items: {
    include: {
      products: true,
      product_variants: true,
      inventory_batches: {
        select: { id: true, batch_number: true, expiration_date: true },
      },
    },
  },
  dispatch_note: {
    select: {
      id: true,
      dispatch_number: true,
      status: true,
      subtype: true,
      emission_date: true,
      // R3-2 — la UI avisa desde qué tienda se sigue el documento.
      store_id: true,
      store: { select: { id: true, name: true } },
    },
  },
  receipt_note: {
    select: {
      id: true,
      dispatch_number: true,
      status: true,
      subtype: true,
      emission_date: true,
      // R3-2 — la UI avisa desde qué tienda se sigue el documento.
      store_id: true,
      store: { select: { id: true, name: true } },
    },
  },
} as const;

@Injectable()
export class StockTransfersService {
  private readonly logger = new Logger(StockTransfersService.name);

  constructor(
    private prisma: StorePrismaService,
    private stockLevelManager: StockLevelManager,
    private readonly event_emitter: EventEmitter2,
    private readonly operatingScopeService: OperatingScopeService,
    private readonly searchPath: PosSearchPathService,
  ) {}

  private async validateTransferScope(
    organizationId: number,
    fromLocationId: number,
    toLocationId: number | null,
    tx: any,
  ): Promise<{
    store_id?: number | null;
    from_store_id: number | null;
    to_store_id: number | null;
  }> {
    const context = RequestContextService.getContext();
    // D8 — un destino externo no tiene bodega: solo se valida el origen.
    const locationIds =
      toLocationId == null
        ? [fromLocationId]
        : [fromLocationId, toLocationId];
    const { scope, locations } =
      await this.operatingScopeService.validateLocationScope(
        organizationId,
        locationIds,
        tx,
      );

    const fromLocation = locations.find(
      (location: any) => location.id === fromLocationId,
    );
    const toLocation =
      toLocationId == null
        ? null
        : (locations.find(
            (location: any) => location.id === toLocationId,
          ) ?? null);

    if (scope === 'ORGANIZATION') {
      return {
        store_id: null,
        from_store_id: fromLocation?.store_id ?? null,
        to_store_id: toLocation?.store_id ?? null,
      };
    }

    const storeId = fromLocation?.store_id ?? null;
    if (!context?.store_id || context.store_id !== storeId) {
      throw new BadRequestException(
        'Cross-store stock transfers are not allowed in STORE operating scope',
      );
    }

    return {
      store_id: storeId,
      from_store_id: storeId,
      to_store_id: toLocation?.store_id ?? null,
    };
  }

  /**
   * Costo unitario con el que sale una línea del origen. Es el mismo criterio
   * de `calculateTransferTotalCost`: CPP del stock, luego costo de la variante
   * y luego del producto. Se lee ANTES de mover para que el destino reciba el
   * costo correcto aunque el origen quede en cero.
   */
  private async resolveOriginUnitCost(
    tx: any,
    line: { product_id: number; product_variant_id?: number | null },
    fromLocationId: number,
  ): Promise<number> {
    const stockLevel = await tx.stock_levels.findFirst({
      where: {
        product_id: line.product_id,
        product_variant_id: line.product_variant_id ?? null,
        location_id: fromLocationId,
      },
      select: {
        cost_per_unit: true,
        products: { select: { cost_price: true } },
        product_variants: { select: { cost_price: true } },
      },
    });

    return (
      Number(stockLevel?.cost_per_unit || 0) ||
      Number(stockLevel?.product_variants?.cost_price || 0) ||
      Number(stockLevel?.products?.cost_price || 0)
    );
  }

  private async calculateTransferTotalCost(
    items: any[] = [],
    fromLocationId: number,
    quantitySelector: (item: any) => number,
  ): Promise<number> {
    let totalCost = 0;

    for (const item of items) {
      const quantity = quantitySelector(item);
      if (quantity <= 0) continue;

      const stockLevel = await this.prisma.stock_levels.findFirst({
        where: {
          product_id: item.product_id,
          product_variant_id: item.product_variant_id ?? null,
          location_id: fromLocationId,
        },
        select: {
          cost_per_unit: true,
          products: { select: { cost_price: true } },
          product_variants: { select: { cost_price: true } },
        },
      });

      const unitCost =
        Number(stockLevel?.cost_per_unit || 0) ||
        Number(stockLevel?.product_variants?.cost_price || 0) ||
        Number(stockLevel?.products?.cost_price || 0);
      totalCost += quantity * unitCost;
    }

    return totalCost;
  }

  /**
   * Conteos por estado para las tarjetas de la pantalla.
   *
   * Los buckets agrupan el estado canónico con su alias legacy porque el enum
   * conserva `draft` y `completed` marcados para borrado diferido: contarlos por
   * separado hacía que las cuatro tarjetas sumaran distinto del total (todas las
   * filas nuevas caían en `pending`/`received`, que no tenían bucket, y
   * `draft`/`completed` mostraban 0).
   */
  async getStats() {
    const [
      total,
      pending,
      approved,
      in_transit,
      partially_received,
      received,
      cancelled,
      closed_with_loss,
    ] = await Promise.all([
      this.prisma.stock_transfers.count(),
      this.prisma.stock_transfers.count({
        where: { status: { in: ['pending', 'draft'] } },
      }),
      this.prisma.stock_transfers.count({ where: { status: 'approved' } }),
      // Una recepción parcial sigue en tránsito: comparte la tarjeta y el
      // filtro con `in_transit` para que la suma de tarjetas sea el total.
      this.prisma.stock_transfers.count({
        where: { status: { in: ['in_transit', 'partially_received'] } },
      }),
      this.prisma.stock_transfers.count({
        where: { status: 'partially_received' },
      }),
      this.prisma.stock_transfers.count({
        where: { status: { in: ['received', 'completed'] } },
      }),
      this.prisma.stock_transfers.count({ where: { status: 'cancelled' } }),
      // D4 — cierre con pérdida: terminal y propio, para que las tarjetas
      // sumen el total aunque la pantalla aún no lo muestre.
      this.prisma.stock_transfers.count({
        where: { status: 'closed_with_loss' },
      }),
    ]);

    return {
      success: true,
      data: {
        total,
        pending,
        approved,
        in_transit,
        partially_received,
        received,
        cancelled,
        closed_with_loss,
        // Alias de compatibilidad para consumidores que aún leen los nombres
        // legacy (frontend web y móvil, hasta que se alineen a los canónicos).
        draft: pending,
        completed: received,
      },
    };
  }

  async create(createTransferDto: CreateTransferDto) {
    return this.prisma.$transaction(async (tx) => {
      const context = RequestContextService.getContext();
      if (!context?.organization_id) {
        throw new BadRequestException('Organization context is required');
      }

      const isExternal =
        createTransferDto.is_external_destination === true;
      // D8 — destino externo: no hay bodega de destino, solo el nombre.
      const toLocationId = isExternal
        ? null
        : (createTransferDto.to_location_id ?? null);

      if (!isExternal) {
        if (toLocationId == null) {
          throw new BadRequestException('Elige la bodega de destino');
        }
        if (createTransferDto.from_location_id === toLocationId) {
          throw new BadRequestException(
            'Source and destination locations must be different',
          );
        }
      } else {
        if (createTransferDto.movement_mode !== 'with_dispatch_notes') {
          throw new VendixHttpException(
            ErrorCodes.INV_TRANSFER_EXTERNAL_REQUIRES_DISPATCH_NOTE,
            'Una salida a destino externo solo se registra con remisión: elige el manejo con remisiones',
          );
        }
        if (!cleanText(createTransferDto.external_destination_name)) {
          throw new BadRequestException(
            'Escribe el nombre del destino externo',
          );
        }
      }

      if (createTransferDto.movement_mode === 'quick') {
        throw new BadRequestException(
          'El movimiento rápido se registra desde su propia acción, no como borrador',
        );
      }

      const scope = await this.validateTransferScope(
        context.organization_id,
        createTransferDto.from_location_id,
        toLocationId,
        tx,
      );

      // Líneas por producto + variante, sin repetidos, y stock disponible por
      // variante en el origen (ver `transfer-item-rules.ts`).
      assertTransferLines(createTransferDto.items);
      await assertStockAvailableAtOrigin(
        tx,
        createTransferDto.items,
        createTransferDto.from_location_id,
      );

      const transport = await resolveTransferTransport(
        tx,
        createTransferDto,
        {
          organization_id: context.organization_id,
          store_id: scope.from_store_id,
          user_id: context.user_id,
        },
      );

      // El lote elegido se valida al crear; el FIFO/FEFO se resuelve recién al
      // despachar, cuando el stock real de la bodega manda (D5).
      const items: Array<{
        product_id: number;
        product_variant_id?: number | null;
        quantity: number;
        notes?: string | null;
        batch_id: number | null;
      }> = [];
      for (const item of createTransferDto.items) {
        items.push({
          product_id: item.product_id,
          product_variant_id: item.product_variant_id ?? null,
          quantity: item.quantity,
          notes: item.notes,
          batch_id: await resolveLineBatch(
            tx,
            item,
            createTransferDto.from_location_id,
            item.batch_id ?? null,
            { defaultToFefo: false },
          ),
        });
      }

      const noSupportAlert = computeNoSupportAlert(createTransferDto);
      const transferNumber = await this.generateTransferNumber(tx);

      return tx.stock_transfers.create({
        data: {
          organization_id: context.organization_id,
          from_location_id: createTransferDto.from_location_id,
          to_location_id: toLocationId,
          notes: createTransferDto.notes,
          transfer_number: transferNumber,
          // Explícito y canónico. Antes se omitía y la fila tomaba el
          // `@default(pending)` del schema, mientras `approve()` y `update()`
          // exigían `draft` — un valor que el propio enum marca como legacy
          // ("deferred drop per Plan §13#2") y que NINGÚN camino de escritura
          // produce. Resultado: toda transferencia creada quedaba inaprobable e
          // ineditable con un 400 permanente, y el único camino vivo era
          // `complete`, justamente el que no validaba nada.
          status: transfer_status_enum.pending,
          transfer_date: new Date(),
          expected_date: createTransferDto.expected_date,
          created_by_user_id: context.user_id,
          movement_mode: (createTransferDto.movement_mode as any) ?? null,
          ...transport,
          is_external_destination: isExternal,
          external_destination_name: cleanText(
            createTransferDto.external_destination_name,
          ),
          external_destination_tax_id: cleanText(
            createTransferDto.external_destination_tax_id,
          ),
          external_destination_address: cleanText(
            createTransferDto.external_destination_address,
          ),
          support_document_type:
            (createTransferDto.support_document_type as any) ?? null,
          support_document_id: cleanText(
            createTransferDto.support_document_id,
          ),
          exit_reason: cleanText(createTransferDto.exit_reason),
          no_support_alert: noSupportAlert,
          stock_transfer_items: {
            create: items,
          },
        },
        include: TRANSFER_FLOW_INCLUDE,
      });
    });
  }

  async createAndComplete(createTransferDto: CreateTransferDto) {
    // D9 — el movimiento rápido solo opera entre bodegas propias. El destino
    // externo existe únicamente en la orden avanzada, con remisión.
    if (createTransferDto.is_external_destination) {
      throw new VendixHttpException(
        ErrorCodes.INV_TRANSFER_QUICK_EXTERNAL_FORBIDDEN,
        'El movimiento rápido solo mueve inventario entre tus propias bodegas; para un destino externo usa la orden avanzada',
      );
    }
    if (
      createTransferDto.movement_mode &&
      createTransferDto.movement_mode !== 'quick'
    ) {
      throw new BadRequestException(
        'El movimiento rápido no admite un modo de orden avanzada',
      );
    }
    if (
      createTransferDto.transport_method &&
      createTransferDto.transport_method !== 'none'
    ) {
      throw new BadRequestException(
        'El movimiento rápido no registra transporte ni remisión: usa la orden avanzada',
      );
    }
    const toLocationId = createTransferDto.to_location_id;
    if (toLocationId == null) {
      throw new BadRequestException('Elige la bodega de destino');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const context = RequestContextService.getContext();
      if (!context?.organization_id) {
        throw new BadRequestException('Organization context is required');
      }

      if (createTransferDto.from_location_id === toLocationId) {
        throw new BadRequestException(
          'Source and destination locations must be different',
        );
      }

      const transferScope = await this.validateTransferScope(
        context.organization_id,
        createTransferDto.from_location_id,
        toLocationId,
        tx,
      );

      // Líneas por producto + variante, sin repetidos, y stock disponible por
      // variante en el origen (ver `transfer-item-rules.ts`).
      assertTransferLines(createTransferDto.items);
      await assertStockAvailableAtOrigin(
        tx,
        createTransferDto.items,
        createTransferDto.from_location_id,
      );

      const transferNumber = await this.generateTransferNumber(tx);

      const stockTransfer = await tx.stock_transfers.create({
        data: {
          organization_id: context.organization_id,
          from_location_id: createTransferDto.from_location_id,
          to_location_id: toLocationId,
          notes: createTransferDto.notes,
          transfer_number: transferNumber,
          transfer_date: new Date(),
          expected_date: createTransferDto.expected_date,
          created_by_user_id: context.user_id,
          approved_by_user_id: context.user_id,
          completed_date: new Date(),
          status: transfer_status_enum.completed,
          movement_mode: 'quick',
          stock_transfer_items: {
            create: createTransferDto.items.map((item) => ({
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              quantity: item.quantity,
              quantity_received: item.quantity,
              notes: item.notes,
            })),
          },
        },
        include: {
          from_location: true,
          to_location: true,
          stock_transfer_items: true,
        },
      });

      // Move stock using StockLevelManager
      for (const item of stockTransfer.stock_transfer_items) {
        const sourceStockUpdate = await this.stockLevelManager.updateStock(
          {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id: stockTransfer.from_location_id,
            quantity_change: -item.quantity,
            movement_type: 'transfer',
            reason: `Stock transfer ${stockTransfer.transfer_number} - source`,
            user_id: context?.user_id,
            create_movement: true,
            // Descuento condicional y atómico: dos "Mover ahora" simultáneos
            // (doble clic, dos pestañas) no pueden sacar las mismas unidades.
            validate_availability: true,
            from_location_id: stockTransfer.from_location_id,
            to_location_id: stockTransfer.to_location_id,
          },
          tx,
        );

        await this.stockLevelManager.updateStock(
          {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id: stockTransfer.to_location_id,
            quantity_change: item.quantity,
            movement_type: 'transfer',
            reason: `Stock transfer ${stockTransfer.transfer_number} - destination`,
            user_id: context?.user_id,
            create_movement: true,
            from_location_id: stockTransfer.from_location_id,
            to_location_id: stockTransfer.to_location_id,
            unit_cost: Number(sourceStockUpdate.cost_snapshot?.unit_cost || 0),
          },
          tx,
        );
      }

      const completed = await tx.stock_transfers.findUnique({
        where: { id: stockTransfer.id },
        include: {
          from_location: true,
          to_location: true,
          stock_transfer_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });
      if (completed) {
        // Flujos P1.1: inventory.transferred in the same transaction
        await recordTriggerEvent(tx, 'inventory.transferred', {
          store_id:
            completed.from_location?.store_id ??
            completed.to_location?.store_id ??
            RequestContextService.getStoreId(),
          transfer_id: completed.id,
          transfer_number: completed.transfer_number,
          from_location_id: completed.from_location_id,
          to_location_id: completed.to_location_id,
        });
      }
      return completed;
    });

    // Emit accounting event for completed stock transfer
    this.event_emitter.emit('stock_transfer.completed', {
      transfer_id: result.id,
      transfer_number: result.transfer_number,
      organization_id: result.organization_id,
      store_id:
        result.from_location?.store_id === result.to_location?.store_id
          ? result.from_location?.store_id
          : undefined,
      from_store_id: result.from_location?.store_id ?? undefined,
      to_store_id: result.to_location?.store_id ?? undefined,
      from_location_id: result.from_location_id,
      to_location_id: result.to_location_id,
      total_cost: await this.calculateTransferTotalCost(
        result.stock_transfer_items,
        result.from_location_id,
        (item) => Number(item.quantity || 0),
      ),
      user_id: RequestContextService.getUserId(),
    });

    return result;
  }

  /**
   * Estados que un filtro canónico debe alcanzar, alias legacy incluido.
   *
   * Las tarjetas ya cuentan `pending` junto a `draft` y `received` junto a
   * `completed` (ver `getStats`), pero el filtro comparaba por igualdad exacta:
   * una transferencia legacy se sumaba en la tarjeta y no aparecía al filtrar
   * por el estado que la tarjeta anuncia. El usuario veía un número que no podía
   * abrir. Se agrupa aquí, en la lectura, sin tocar el enum ni una sola fila.
   */
  private static readonly STATUS_FILTER_GROUPS: Record<string, string[]> = {
    pending: ['pending', 'draft'],
    draft: ['pending', 'draft'],
    // D4 — el saldo pendiente sigue en camino: la pestaña "En tránsito"
    // muestra también las recepciones parciales.
    in_transit: ['in_transit', 'partially_received'],
    partially_received: ['partially_received'],
    received: ['received', 'completed'],
    completed: ['received', 'completed'],
  };

  findAll(query: TransferQueryDto) {
    const statusGroup = query.status
      ? StockTransfersService.STATUS_FILTER_GROUPS[query.status]
      : undefined;

    const where: any = {
      from_location_id: query.from_location_id,
      to_location_id: query.to_location_id,
      status: statusGroup ? { in: statusGroup } : query.status,
      ...(query.with_alert ? { no_support_alert: true } : {}),
    };

    if (query.transfer_date_from || query.transfer_date_to) {
      where.transfer_date = {};
      if (query.transfer_date_from) {
        where.transfer_date.gte = query.transfer_date_from;
      }
      if (query.transfer_date_to) {
        where.transfer_date.lte = query.transfer_date_to;
      }
    }

    if (query.search) {
      // `reference_number` y `reason` NO son columnas de `stock_transfers`
      // (las reales son `notes` y `cancellation_reason`): Prisma lanzaba
      // `Unknown argument` y CUALQUIER búsqueda respondía 500, dejando la lista
      // inutilizable en modo búsqueda. `mode: 'insensitive'` porque los números
      // se muestran en mayúsculas (`TRF-0001`) y se teclean en minúsculas — el
      // mismo archivo ya lo usa en `searchTransferableProducts`.
      where.OR = [
        { transfer_number: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } },
        {
          cancellation_reason: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
      ];
    }

    if (query.product_id) {
      where.stock_transfer_items = {
        some: {
          product_id: query.product_id,
        },
      };
    }

    return this.prisma.stock_transfers.findMany({
      where,
      include: {
        from_location: true,
        to_location: true,
        stock_transfer_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
      orderBy: {
        transfer_date: 'desc',
      },
    });
  }

  findByStatus(status: transfer_status_enum, query: TransferQueryDto) {
    return this.findAll({
      ...query,
      status,
    });
  }

  findByFromLocation(locationId: number, query: TransferQueryDto) {
    return this.findAll({
      ...query,
      from_location_id: locationId,
    });
  }

  findByToLocation(locationId: number, query: TransferQueryDto) {
    return this.findAll({
      ...query,
      to_location_id: locationId,
    });
  }

  findOne(id: number) {
    return this.prisma.stock_transfers.findUnique({
      where: { id },
      include: TRANSFER_FLOW_INCLUDE,
    });
  }

  async update(id: number, updateTransferDto: UpdateTransferDto) {
    const existingTransfer = await this.prisma.stock_transfers.findUnique({
      where: { id },
    });

    // `findUnique` devuelve null con un id inexistente: sin esta guarda, la
    // línea siguiente reventaba con un TypeError como 500 en vez de 404.
    if (!existingTransfer) {
      throw new NotFoundException(`Transferencia #${id} no encontrada`);
    }

    if (!PENDING_LIKE_STATUSES.includes(existingTransfer.status)) {
      throw new BadRequestException(
        'Solo una transferencia pendiente puede editarse',
      );
    }

    // Lista blanca explícita de cabecera. `items` se ignora (las líneas no se
    // editan por acá) y los campos avanzados —modo, destino externo,
    // transporte, documento soporte— no se aceptan: sus validaciones viven en
    // `create`/`dispatch` y escribirlos crudos las saltaba.
    const dto = updateTransferDto as UpdateTransferDto;
    // `IsOptional` deja pasar `null`: sin esto, `to_location_id: null` dejaba
    // una transferencia interna sin destino y `from_location_id: null` daba 500.
    if ((dto.from_location_id as unknown) === null) {
      throw new BadRequestException('Elige la bodega de origen');
    }
    if (
      (dto.to_location_id as unknown) === null &&
      !existingTransfer.is_external_destination
    ) {
      throw new BadRequestException('Elige la bodega de destino');
    }
    const headerData: Prisma.stock_transfersUncheckedUpdateInput = {
      ...(dto.from_location_id !== undefined && {
        from_location_id: dto.from_location_id,
      }),
      ...(dto.to_location_id !== undefined && {
        to_location_id: dto.to_location_id,
      }),
      ...(dto.expected_date !== undefined && {
        expected_date: dto.expected_date,
      }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
    };

    if (
      dto.from_location_id !== undefined ||
      dto.to_location_id !== undefined
    ) {
      // D8 — una salida externa no tiene bodega de destino: asignarle una
      // dejaría `is_external_destination=true` con destino interno.
      if (
        existingTransfer.is_external_destination &&
        dto.to_location_id != null
      ) {
        throw new BadRequestException(
          'Una salida a destino externo no tiene bodega de destino',
        );
      }
      const nextFrom = dto.from_location_id ?? existingTransfer.from_location_id;
      const nextTo = dto.to_location_id ?? existingTransfer.to_location_id;
      if (nextTo != null && nextFrom === nextTo) {
        throw new BadRequestException(
          'Source and destination locations must be different',
        );
      }
      // Cambiar el par de bodegas re-valida el alcance: sin esto se podía mover
      // el origen a una bodega de otra tienda esquivando el bloqueo de `create`.
      await this.validateTransferScope(
        existingTransfer.organization_id,
        nextFrom,
        nextTo,
        this.prisma,
      );
    }

    return this.prisma.stock_transfers.update({
      where: { id },
      data: headerData,
      include: {
        from_location: true,
        to_location: true,
        stock_transfer_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async approve(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const stockTransfer = await tx.stock_transfers.findUnique({
        where: { id },
        include: { stock_transfer_items: true },
      });

      if (!stockTransfer) {
        throw new NotFoundException(`Transferencia #${id} no encontrada`);
      }

      await this.validateTransferScope(
        stockTransfer.organization_id,
        stockTransfer.from_location_id,
        stockTransfer.to_location_id,
        tx,
      );

      if (!PENDING_LIKE_STATUSES.includes(stockTransfer.status)) {
        throw new BadRequestException(
          'Solo una transferencia pendiente puede aprobarse',
        );
      }

      const context = RequestContextService.getContext();

      // Reserva el stock del origen. El descuento real ocurre al despachar.
      for (const item of stockTransfer.stock_transfer_items) {
        await this.stockLevelManager.reserveStock(
          item.product_id,
          item.product_variant_id ?? undefined,
          stockTransfer.from_location_id,
          item.quantity,
          'transfer',
          stockTransfer.id,
          context?.user_id,
          true,
          tx,
        );
      }

      return tx.stock_transfers.update({
        where: { id },
        data: {
          status: transfer_status_enum.in_transit,
          approved_at: new Date(),
          approved_by_user_id: context?.user_id ?? null,
        },
        include: TRANSFER_FLOW_INCLUDE,
      });
    });
  }

  /**
   * Despacho físico (D3): descuenta el origen, guarda el conteo de salida por
   * línea (`quantity_dispatched`), el lote (D5) y el transporte/costo (D6), y
   * crea la remisión `transfer_out` en la MISMA transacción cuando el modo es
   * `with_dispatch_notes`.
   *
   * Modos:
   * - `mass_only`: suma en destino y cierra la transferencia (no hay recepción
   *   aparte; D3 "solo movimiento masivo").
   * - destino externo (D8): solo salida, sin bodega de destino; queda
   *   `completed` porque no hay nada que recibir.
   * - `with_dispatch_notes` o sin modo (filas históricas): queda en tránsito
   *   para recibirse después.
   *
   * Idempotencia: si la transferencia ya tiene `dispatched_at` o alguna línea
   * con `quantity_dispatched`, se rechaza. Dos despachos no pueden descontar
   * dos veces.
   */
  async dispatch(id: number, dto: DispatchTransferDto = {}) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const stockTransfer = await tx.stock_transfers.findUnique({
        where: { id },
        include: { stock_transfer_items: true },
      });

      if (!stockTransfer) {
        throw new NotFoundException(`Transferencia #${id} no encontrada`);
      }

      const context = RequestContextService.getContext();
      const scope = await this.validateTransferScope(
        stockTransfer.organization_id,
        stockTransfer.from_location_id,
        stockTransfer.to_location_id,
        tx,
      );

      if (stockTransfer.movement_mode === 'quick') {
        throw new BadRequestException(
          'Esta transferencia es un movimiento rápido: el inventario ya se movió',
        );
      }

      if (
        stockTransfer.status !== transfer_status_enum.in_transit &&
        stockTransfer.status !== transfer_status_enum.approved
      ) {
        throw new BadRequestException(
          'Solo una transferencia aprobada puede despacharse',
        );
      }

      if (
        stockTransfer.dispatched_at != null ||
        stockTransfer.stock_transfer_items.some(
          (item: any) => item.quantity_dispatched != null,
        )
      ) {
        throw new ConflictException(
          `La transferencia ${stockTransfer.transfer_number} ya fue despachada`,
        );
      }

      // Reclamo atómico del despacho: dos peticiones simultáneas (doble clic,
      // dos pestañas) compiten por la misma fila; la segunda encuentra
      // `dispatched_at` ya escrito y no vuelve a descontar stock. El estado va
      // en la condición para que un cancelar concurrente no deje despachar una
      // transferencia que ya dejó de estar aprobada.
      const claim = await tx.stock_transfers.updateMany({
        where: {
          id,
          dispatched_at: null,
          status: {
            in: [
              transfer_status_enum.approved,
              transfer_status_enum.in_transit,
            ],
          },
        },
        data: {
          dispatched_at: new Date(),
          dispatched_by_user_id: context?.user_id ?? null,
        },
      });
      if (claim.count === 0) {
        throw new ConflictException(
          `La transferencia ${stockTransfer.transfer_number} ya fue despachada`,
        );
      }

      const isExternal = stockTransfer.is_external_destination === true;
      if (isExternal) {
        if (stockTransfer.movement_mode !== 'with_dispatch_notes') {
          throw new VendixHttpException(
            ErrorCodes.INV_TRANSFER_EXTERNAL_REQUIRES_DISPATCH_NOTE,
            'Una salida a destino externo necesita remisión',
          );
        }
      } else if (stockTransfer.to_location_id == null) {
        throw new BadRequestException(
          'La transferencia no tiene bodega de destino',
        );
      }

      const plan = buildDispatchPlan(
        stockTransfer.stock_transfer_items,
        dto.items,
      );

      // Las reservas del origen se consumen ANTES de validar disponibilidad:
      // `reserveStock` ya descontó `quantity_available`, así que si quedaran
      // activas el despacho fallaría contra su propia reserva. No se toca el
      // on-hand acá: eso lo hace `updateStock`, que también deja el movimiento
      // y la valuación.
      await this.stockLevelManager.releaseReservationsByReference(
        'transfer',
        stockTransfer.id,
        'consumed',
        tx,
        { decrementOnHand: false },
      );

      // Disponibilidad real del origen antes de escribir nada.
      await assertStockAvailableAtOrigin(
        tx,
        plan
          .filter((entry) => entry.quantity_dispatched > 0)
          .map((entry) => ({
            product_id: entry.line.product_id,
            product_variant_id: entry.line.product_variant_id,
            quantity: entry.quantity_dispatched,
          })),
        stockTransfer.from_location_id,
      );

      // Lote por línea: el elegido en el payload, el ya guardado o el más
      // antiguo con saldo (FEFO). El lote queda ligado a la fila.
      const batchNumbers = new Map<number, string>();
      for (const entry of plan) {
        if (entry.quantity_dispatched <= 0) continue;
        entry.batch_id = await resolveLineBatch(
          tx,
          entry.line,
          stockTransfer.from_location_id,
          entry.batch_id,
          { defaultToFefo: true },
        );
        if (entry.batch_id != null && !batchNumbers.has(entry.batch_id)) {
          const batch = await tx.inventory_batches.findFirst({
            where: { id: entry.batch_id },
            select: { batch_number: true },
          });
          if (batch?.batch_number) {
            batchNumbers.set(entry.batch_id, batch.batch_number);
          }
        }
      }

      // El transporte se guarda al crear; el despacho solo lo reemplaza si
      // trae un método. Sin `transport_method` las columnas no se tocan (antes
      // se resolvía un bloque vacío y borraba vehículo, conductor y costo).
      const transport =
        dto.transport_method !== undefined
          ? await resolveTransferTransport(tx, dto, {
              organization_id: stockTransfer.organization_id,
              store_id: scope.from_store_id,
              user_id: context?.user_id,
            })
          : {};

      const wantsDispatchNote =
        stockTransfer.movement_mode === 'with_dispatch_notes' || isExternal;
      let dispatchNoteId: number | null =
        stockTransfer.dispatch_note_id ?? null;

      if (wantsDispatchNote) {
        // N3 / R3-1 — la remisión vive en la tienda del contexto (es donde el
        // scope de `dispatch_notes` la crea y donde se lee el consecutivo), y
        // esa tienda debe ser la de origen o la de destino de la transferencia.
        const noteStoreId = resolveStoreSurfaceNoteStoreId(
          RequestContextService.getStoreId(),
          scope,
        );
        const note = await createTransferNoteInTx(tx, {
          store_id: noteStoreId,
          direction: 'outbound',
          subtype: 'transfer_out',
          from_location_id: stockTransfer.from_location_id,
          to_location_id: stockTransfer.to_location_id,
          items: plan
            .filter((entry) => entry.quantity_dispatched > 0)
            .map((entry) => ({
              product_id: entry.line.product_id,
              product_variant_id: entry.line.product_variant_id,
              quantity: entry.quantity_dispatched,
              lot_serial:
                entry.batch_id != null
                  ? (batchNumbers.get(entry.batch_id) ?? null)
                  : null,
            })),
          notes: `Remisión de salida de la transferencia ${stockTransfer.transfer_number}`,
          internal_notes: stockTransfer.no_support_alert
            ? noSupportAlertNote()
            : null,
          external: isExternal
            ? {
                name: stockTransfer.external_destination_name,
                tax_id: stockTransfer.external_destination_tax_id,
                address: stockTransfer.external_destination_address,
              }
            : null,
          user_id: context?.user_id,
        });
        dispatchNoteId = note.id;
      }

      const sourceCosts = new Map<number, number>();
      for (const entry of plan) {
        // Toda línea del plan deja su conteo de salida, incluido el 0: un
        // `quantity_dispatched` NULL se lee como "salió completa" (fila
        // histórica) y recibir, cancelar o cerrar con pérdida operarían sobre
        // unidades que nunca salieron del origen.
        if (entry.quantity_dispatched <= 0) {
          await tx.stock_transfer_items.update({
            where: { id: entry.line.id },
            data: { quantity_dispatched: 0 },
          });
          entry.line.quantity_dispatched = 0;
          continue;
        }
        const source = await this.stockLevelManager.updateStock(
          {
            product_id: entry.line.product_id,
            variant_id: entry.line.product_variant_id ?? undefined,
            location_id: stockTransfer.from_location_id,
            quantity_change: -entry.quantity_dispatched,
            movement_type: 'transfer',
            reason: `Stock transfer ${stockTransfer.transfer_number} - source`,
            user_id: context?.user_id,
            create_movement: true,
            validate_availability: true,
            from_location_id: stockTransfer.from_location_id,
            to_location_id: stockTransfer.to_location_id ?? undefined,
          },
          tx,
        );
        sourceCosts.set(
          entry.line.id,
          Number(source.cost_snapshot?.unit_cost || 0),
        );

        await tx.stock_transfer_items.update({
          where: { id: entry.line.id },
          data: {
            quantity_dispatched: entry.quantity_dispatched,
            batch_id: entry.batch_id,
          },
        });
        entry.line.quantity_dispatched = entry.quantity_dispatched;
      }

      const now = new Date();
      let status: transfer_status_enum = transfer_status_enum.in_transit;
      let completedDate: Date | null = null;
      let totalCost = 0;

      if (isExternal) {
        // D8 — la salida externa termina en el despacho: no hay recepción.
        // `completed` es terminal y la bandera `is_external_destination`
        // distingue estas filas de una recepción normal.
        status = transfer_status_enum.completed;
        completedDate = now;
        totalCost = plan.reduce(
          (sum, entry) =>
            sum +
            (sourceCosts.get(entry.line.id) ?? 0) *
              entry.quantity_dispatched,
          0,
        );
      } else if (stockTransfer.movement_mode === 'mass_only') {
        // D3 — el movimiento masivo aplica todo de una vez, sin remisiones.
        for (const entry of plan) {
          if (entry.quantity_dispatched <= 0) continue;
          const unitCost = sourceCosts.get(entry.line.id) ?? 0;
          await this.stockLevelManager.updateStock(
            {
              product_id: entry.line.product_id,
              variant_id: entry.line.product_variant_id ?? undefined,
              location_id: stockTransfer.to_location_id as number,
              quantity_change: entry.quantity_dispatched,
              movement_type: 'transfer',
              reason: `Stock transfer ${stockTransfer.transfer_number} - destination`,
              user_id: context?.user_id,
              create_movement: true,
              from_location_id: stockTransfer.from_location_id,
              to_location_id: stockTransfer.to_location_id ?? undefined,
              unit_cost: unitCost,
            },
            tx,
          );
          await tx.stock_transfer_items.update({
            where: { id: entry.line.id },
            data: { quantity_received: entry.quantity_dispatched },
          });
          totalCost += unitCost * entry.quantity_dispatched;
        }
        status = transfer_status_enum.received;
        completedDate = now;
      }

      const updated = await tx.stock_transfers.update({
        where: { id },
        data: {
          ...transport,
          dispatch_note_id: dispatchNoteId,
          dispatched_at: now,
          dispatched_by_user_id: context?.user_id ?? null,
          status,
          completed_date: completedDate,
          notes: appendTransferNote(stockTransfer.notes, dto.notes),
        },
        include: TRANSFER_FLOW_INCLUDE,
      });

      if (
        (status === transfer_status_enum.received ||
          status === transfer_status_enum.completed) &&
        updated.to_location_id != null
      ) {
        await recordTriggerEvent(tx, 'inventory.transferred', {
          store_id:
            updated.from_location?.store_id ??
            updated.to_location?.store_id ??
            RequestContextService.getStoreId(),
          transfer_id: updated.id,
          transfer_number: updated.transfer_number,
          from_location_id: updated.from_location_id,
          to_location_id: updated.to_location_id,
        });
      }

      return { transfer: updated, totalCost };
    });

    // Una salida externa no tiene destino interno: el asiento de traslado no
    // aplica y el listener contable espera un `to_location_id` numérico.
    if (
      (outcome.transfer.status === transfer_status_enum.received ||
        outcome.transfer.status === transfer_status_enum.completed) &&
      outcome.transfer.to_location_id != null
    ) {
      this.event_emitter.emit('stock_transfer.completed', {
        transfer_id: outcome.transfer.id,
        transfer_number: outcome.transfer.transfer_number,
        organization_id: outcome.transfer.organization_id,
        store_id:
          outcome.transfer.from_location?.store_id ===
          outcome.transfer.to_location?.store_id
            ? outcome.transfer.from_location?.store_id
            : undefined,
        from_store_id: outcome.transfer.from_location?.store_id ?? undefined,
        to_store_id: outcome.transfer.to_location?.store_id ?? undefined,
        from_location_id: outcome.transfer.from_location_id,
        to_location_id: outcome.transfer.to_location_id,
        total_cost: outcome.totalCost,
        user_id: RequestContextService.getUserId(),
      });
    }

    return outcome.transfer;
  }

  /**
   * Recepción repetible (D4). Suma en destino SOLO lo que llega ahora, así que
   * dos recepciones parciales no duplican stock. Cuando queda saldo pendiente
   * la transferencia pasa a `partially_received`; al completarse, a `received`.
   *
   * Compatibilidad: una transferencia que nunca pasó por `dispatch` (flujo
   * anterior: aprobar reservaba y completar movía) descuenta el origen en esta
   * recepción, igual que antes. Las despachadas ya descontaron en `dispatch` y
   * acá solo acreditan destino — sin doble movimiento.
   */
  async receive(
    id: number,
    items: Array<{ id: number; quantity_received: number }>,
    notes?: string,
  ) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      // Serializa recepciones simultáneas sobre la misma fila: la segunda
      // espera el commit de la primera y vuelve a leer el saldo ya actualizado,
      // así un doble envío no puede sumar dos veces las mismas unidades.
      await tx.stock_transfers.updateMany({
        where: { id },
        data: { updated_at: new Date() },
      });

      const stockTransfer = await tx.stock_transfers.findUnique({
        where: { id },
        include: { stock_transfer_items: true },
      });

      if (!stockTransfer) {
        throw new NotFoundException(`Transferencia #${id} no encontrada`);
      }

      const context = RequestContextService.getContext();
      const scope = await this.validateTransferScope(
        stockTransfer.organization_id,
        stockTransfer.from_location_id,
        stockTransfer.to_location_id,
        tx,
      );

      if (stockTransfer.is_external_destination) {
        throw new BadRequestException(
          'Una salida a destino externo no se recibe: se cierra al despachar',
        );
      }
      if (stockTransfer.to_location_id == null) {
        throw new BadRequestException(
          'La transferencia no tiene bodega de destino',
        );
      }
      if (
        stockTransfer.status !== transfer_status_enum.in_transit &&
        stockTransfer.status !== transfer_status_enum.partially_received
      ) {
        throw new BadRequestException(
          'Solo una transferencia despachada o con recepción parcial puede recibirse',
        );
      }
      if (requiresDispatchFirst(stockTransfer)) {
        throw new BadRequestException(
          'Despacha la transferencia antes de recibirla',
        );
      }

      // R3-1 — la remisión de entrada se emite en la tienda del contexto, que
      // debe ser la de origen o la de destino. Se valida antes de mover stock.
      const receiptNoteStoreId =
        stockTransfer.movement_mode === 'with_dispatch_notes'
          ? resolveStoreSurfaceNoteStoreId(
              RequestContextService.getStoreId(),
              scope,
            )
          : null;

      const linesById = new Map<number, any>(
        stockTransfer.stock_transfer_items.map((line: any) => [
          line.id,
          line,
        ]),
      );
      const seen = new Set<number>();
      const normalized: Array<{ line: any; quantity: number }> = [];

      for (const received of items) {
        if (seen.has(received.id)) {
          throw new BadRequestException(
            `La línea #${received.id} está repetida en la recepción`,
          );
        }
        seen.add(received.id);
        const line = linesById.get(received.id);
        if (!line) {
          throw new BadRequestException(
            `La línea #${received.id} no pertenece a la transferencia #${id}`,
          );
        }
        if (
          !Number.isInteger(received.quantity_received) ||
          received.quantity_received < 0
        ) {
          throw new BadRequestException(
            `La cantidad recibida de la línea #${received.id} debe ser un entero mayor o igual a cero`,
          );
        }
        const pending = pendingQuantity(line);
        if (received.quantity_received > pending) {
          throw new BadRequestException(
            `No puedes recibir ${received.quantity_received} de la línea #${received.id}: el saldo pendiente es ${pending}`,
          );
        }
        normalized.push({ line, quantity: received.quantity_received });
      }

      const toReceive = normalized.filter((entry) => entry.quantity > 0);
      if (toReceive.length === 0) {
        throw new BadRequestException(
          'Escribe al menos una cantidad recibida mayor que cero',
        );
      }

      // Flujo anterior (sin despacho y sin modo de movimiento): el descuento
      // del origen no ocurrió todavía. Se hace acá para no romper las
      // transferencias creadas antes de P2 ni las que se aprueban y completan
      // de una vez. Un modo avanzado sin despacho ya se rechazó arriba.
      const legacyUndispatched = isNeverDispatched(stockTransfer);

      if (legacyUndispatched) {
        await this.stockLevelManager.releaseReservationsByReference(
          'transfer',
          stockTransfer.id,
          'consumed',
          tx,
          { decrementOnHand: false },
        );
      }

      for (const entry of toReceive) {
        const line = entry.line;
        let unitCost = await this.resolveOriginUnitCost(
          tx,
          line,
          stockTransfer.from_location_id,
        );

        if (legacyUndispatched) {
          const source = await this.stockLevelManager.updateStock(
            {
              product_id: line.product_id,
              variant_id: line.product_variant_id ?? undefined,
              location_id: stockTransfer.from_location_id,
              quantity_change: -entry.quantity,
              movement_type: 'transfer',
              reason: `Stock transfer ${stockTransfer.transfer_number} - source`,
              user_id: context?.user_id,
              create_movement: true,
              from_location_id: stockTransfer.from_location_id,
              to_location_id: stockTransfer.to_location_id ?? undefined,
            },
            tx,
          );
          unitCost =
            Number(source.cost_snapshot?.unit_cost || 0) || unitCost;
        }

        await this.stockLevelManager.updateStock(
          {
            product_id: line.product_id,
            variant_id: line.product_variant_id ?? undefined,
            location_id: stockTransfer.to_location_id as number,
            quantity_change: entry.quantity,
            movement_type: 'transfer',
            reason: `Stock transfer ${stockTransfer.transfer_number} - destination`,
            user_id: context?.user_id,
            create_movement: true,
            from_location_id: stockTransfer.from_location_id,
            to_location_id: stockTransfer.to_location_id ?? undefined,
            unit_cost: unitCost,
          },
          tx,
        );

        await tx.stock_transfer_items.update({
          where: { id: line.id },
          data: {
            quantity_received:
              Number(line.quantity_received ?? 0) + entry.quantity,
          },
        });
        line.quantity_received =
          Number(line.quantity_received ?? 0) + entry.quantity;
      }

      let receiptNoteId = stockTransfer.receipt_note_id ?? null;
      if (receiptNoteStoreId != null && stockTransfer.to_location_id != null) {
        // N3 / R3-1 — la remisión de entrada queda en la tienda del contexto,
        // la única donde el scope de tienda deja crearla y leerla, y que ya se
        // validó como origen o destino de la transferencia. Con alcance de
        // tienda `validateTransferScope` exige que el contexto sea la tienda
        // de origen, así que ahí la entrada queda en el origen (la superficie
        // de organización la deja en el destino). Si una recepción anterior la
        // dejó en otra tienda, no se duplica: se rechaza con 409.
        receiptNoteId = await accumulateTransferReceiptNoteInTx(tx, {
          existing_note_id: receiptNoteId,
          on_missing_existing: 'reject',
          store_id: receiptNoteStoreId,
          direction: 'inbound',
          subtype: 'transfer_in',
          from_location_id: stockTransfer.from_location_id,
          to_location_id: stockTransfer.to_location_id,
          items: toReceive.map((entry) => ({
            product_id: entry.line.product_id,
            product_variant_id: entry.line.product_variant_id,
            quantity: entry.quantity,
          })),
          notes: `Remisión de entrada de la transferencia ${stockTransfer.transfer_number}`,
          user_id: context?.user_id,
        });
      }

      const refreshed = await tx.stock_transfer_items.findMany({
        where: { stock_transfer_id: id },
      });
      const fullyReceived = refreshed.every(
        (line: any) => line.quantity_received >= dispatchedQuantity(line),
      );

      const updated = await tx.stock_transfers.update({
        where: { id },
        data: {
          status: fullyReceived
            ? transfer_status_enum.received
            : transfer_status_enum.partially_received,
          completed_date: fullyReceived ? new Date() : null,
          receipt_note_id: receiptNoteId,
          notes: appendTransferNote(stockTransfer.notes, notes),
        },
        include: TRANSFER_FLOW_INCLUDE,
      });

      if (fullyReceived) {
        await recordTriggerEvent(tx, 'inventory.transferred', {
          store_id:
            updated.from_location?.store_id ??
            updated.to_location?.store_id ??
            RequestContextService.getStoreId(),
          transfer_id: updated.id,
          transfer_number: updated.transfer_number,
          from_location_id: updated.from_location_id,
          to_location_id: updated.to_location_id,
        });
      }

      return { transfer: updated, fullyReceived };
    });

    if (outcome.fullyReceived) {
      this.event_emitter.emit('stock_transfer.completed', {
        transfer_id: outcome.transfer.id,
        transfer_number: outcome.transfer.transfer_number,
        organization_id: outcome.transfer.organization_id,
        store_id:
          outcome.transfer.from_location?.store_id ===
          outcome.transfer.to_location?.store_id
            ? outcome.transfer.from_location?.store_id
            : undefined,
        from_store_id: outcome.transfer.from_location?.store_id ?? undefined,
        to_store_id: outcome.transfer.to_location?.store_id ?? undefined,
        from_location_id: outcome.transfer.from_location_id,
        to_location_id: outcome.transfer.to_location_id,
        total_cost: await this.calculateTransferTotalCost(
          outcome.transfer.stock_transfer_items,
          outcome.transfer.from_location_id,
          (item: any) => Number(item.quantity_received || 0),
        ),
        user_id: RequestContextService.getUserId(),
      });
    }

    return outcome.transfer;
  }

  /**
   * Compatibilidad con el endpoint `PATCH :id/complete`: recibir es la misma
   * operación, ahora incremental y repetible.
   */
  async complete(
    id: number,
    items: Array<{ id: number; quantity_received: number }>,
  ) {
    return this.receive(id, items);
  }

  /**
   * D4 — cierre del saldo pendiente como pérdida. Solo después de la fecha
   * límite de entrega (`expected_date`) y con motivo obligatorio.
   *
   * Si la transferencia YA se despachó, las unidades pendientes salieron del
   * origen en el despacho: acá solo se registran como pérdidas (`quantity_lost`)
   * para no descontar dos veces. Si nunca se despachó (flujo anterior), sí se
   * crea el movimiento de merma en el origen, porque esas unidades seguían ahí.
   */
  async closeWithLoss(
    id: number,
    reasonInput: string,
    notes?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Mismo candado de fila que `receive`: una recepción y un cierre con
      // pérdida simultáneos se serializan y el segundo lee el saldo y el
      // estado ya actualizados (no puede dar de baja lo que acaba de entrar).
      await tx.stock_transfers.updateMany({
        where: { id },
        data: { updated_at: new Date() },
      });

      const stockTransfer = await tx.stock_transfers.findUnique({
        where: { id },
        include: { stock_transfer_items: true },
      });

      if (!stockTransfer) {
        throw new NotFoundException(`Transferencia #${id} no encontrada`);
      }

      const context = RequestContextService.getContext();
      await this.validateTransferScope(
        stockTransfer.organization_id,
        stockTransfer.from_location_id,
        stockTransfer.to_location_id,
        tx,
      );

      if (stockTransfer.is_external_destination) {
        throw new BadRequestException(
          'Una salida a destino externo se cierra al despachar: no tiene saldo pendiente',
        );
      }

      if (
        stockTransfer.status !== transfer_status_enum.in_transit &&
        stockTransfer.status !== transfer_status_enum.partially_received
      ) {
        throw new BadRequestException(
          'Solo una transferencia despachada con saldo pendiente puede cerrarse como pérdida',
        );
      }
      if (requiresDispatchFirst(stockTransfer)) {
        throw new BadRequestException(
          'Despacha la transferencia antes de cerrarla como pérdida',
        );
      }

      const reason = reasonInput?.trim();
      if (!reason) {
        throw new VendixHttpException(
          ErrorCodes.INV_TRANSFER_LOSS_REASON_REQUIRED,
          'Escribe el motivo de la pérdida',
        );
      }

      if (!stockTransfer.expected_date) {
        throw new BadRequestException(
          'La transferencia no tiene fecha límite de entrega: agrega una antes de cerrar la pérdida',
        );
      }

      if (!hasDeliveryDeadlinePassed(stockTransfer.expected_date)) {
        throw new VendixHttpException(
          ErrorCodes.INV_TRANSFER_LOSS_NOT_DUE,
          'Todavía no vence la fecha límite de entrega: podrás cerrar la pérdida después de esa fecha',
        );
      }

      const pendingLines = stockTransfer.stock_transfer_items
        .map((line: any) => ({ line, pending: pendingQuantity(line) }))
        .filter((entry: any) => entry.pending > 0);

      if (pendingLines.length === 0) {
        throw new BadRequestException(
          'No hay saldo pendiente: la transferencia ya está completa',
        );
      }

      const legacyUndispatched = isNeverDispatched(stockTransfer);

      if (legacyUndispatched) {
        await this.stockLevelManager.releaseReservationsByReference(
          'transfer',
          stockTransfer.id,
          'consumed',
          tx,
          { decrementOnHand: false },
        );
        for (const entry of pendingLines) {
          await this.stockLevelManager.updateStock(
            {
              product_id: entry.line.product_id,
              variant_id: entry.line.product_variant_id ?? undefined,
              location_id: stockTransfer.from_location_id,
              quantity_change: -entry.pending,
              movement_type: 'damage',
              reason: `Merma de transferencia ${stockTransfer.transfer_number}: ${reason}`,
              user_id: context?.user_id,
              create_movement: true,
              validate_availability: true,
              from_location_id: stockTransfer.from_location_id,
              to_location_id: stockTransfer.to_location_id ?? undefined,
            },
            tx,
          );
        }
      }

      for (const entry of pendingLines) {
        await tx.stock_transfer_items.update({
          where: { id: entry.line.id },
          data: {
            quantity_lost:
              Number(entry.line.quantity_lost ?? 0) + entry.pending,
          },
        });
      }

      return tx.stock_transfers.update({
        where: { id },
        data: {
          status: transfer_status_enum.closed_with_loss,
          loss_closed_at: new Date(),
          loss_closed_by_user_id: context?.user_id ?? null,
          loss_reason: reason,
          notes: appendTransferNote(stockTransfer.notes, notes),
        },
        include: TRANSFER_FLOW_INCLUDE,
      });
    });
  }

  async cancel(id: number) {
    return this.prisma.$transaction(async (tx) => {
      // Candado de fila condicionado por estado, igual que el reclamo del
      // despacho: una recepción, un despacho o un cierre concurrentes se
      // serializan con esta cancelación. Si el otro terminó primero y dejó la
      // transferencia en un estado terminal, no se toca nada; si no, la lectura
      // de abajo ya ve su saldo y no devuelve al origen lo que entró a destino.
      const lock = await tx.stock_transfers.updateMany({
        where: { id, status: { notIn: TRANSFER_TERMINAL_STATUSES } },
        data: { updated_at: new Date() },
      });

      const stockTransfer = await tx.stock_transfers.findUnique({
        where: { id },
        include: { stock_transfer_items: true },
      });

      if (!stockTransfer) {
        throw new NotFoundException(`Transferencia #${id} no encontrada`);
      }

      // Cancelar libera reservas o devuelve stock al origen, así que es un
      // movimiento real y necesita la misma guarda de alcance.
      await this.validateTransferScope(
        stockTransfer.organization_id,
        stockTransfer.from_location_id,
        stockTransfer.to_location_id,
        tx,
      );

      // `received` también es terminal: es el estado que escribe el flujo de
      // organización sobre esta MISMA tabla. `closed_with_loss` lo es desde P2.
      if (
        stockTransfer.status === transfer_status_enum.completed ||
        stockTransfer.status === transfer_status_enum.received ||
        stockTransfer.status === transfer_status_enum.closed_with_loss
      ) {
        throw new BadRequestException(
          'Una transferencia ya recibida o cerrada no se puede cancelar',
        );
      }
      if (stockTransfer.status === transfer_status_enum.cancelled) {
        throw new BadRequestException('La transferencia ya está cancelada');
      }
      if (lock.count === 0) {
        throw new ConflictException(
          `La transferencia ${stockTransfer.transfer_number} cambió mientras se cancelaba: actualiza e intenta de nuevo`,
        );
      }

      const wasDispatched =
        stockTransfer.dispatched_at != null ||
        stockTransfer.stock_transfer_items.some(
          (item: any) => item.quantity_dispatched != null,
        );

      if (wasDispatched) {
        // Lo despachado y no recibido vuelve al origen; lo recibido ya está en
        // destino y no se toca. Una salida externa es terminal y no llega acá.
        for (const item of stockTransfer.stock_transfer_items) {
          const pending = pendingQuantity(item);
          if (pending <= 0) continue;
          await this.stockLevelManager.updateStock(
            {
              product_id: item.product_id,
              variant_id: item.product_variant_id ?? undefined,
              location_id: stockTransfer.from_location_id,
              quantity_change: pending,
              movement_type: 'transfer',
              reason: `Stock transfer ${stockTransfer.transfer_number} - cancelled return`,
              user_id: RequestContextService.getUserId(),
              create_movement: true,
              from_location_id: stockTransfer.from_location_id,
              to_location_id: stockTransfer.to_location_id ?? undefined,
            },
            tx,
          );
        }
      } else if (stockTransfer.status === transfer_status_enum.in_transit) {
        await this.stockLevelManager.releaseReservationsByReference(
          'transfer',
          stockTransfer.id,
          'cancelled',
          tx,
        );
      }

      return tx.stock_transfers.update({
        where: { id },
        data: {
          status: transfer_status_enum.cancelled,
        },
        include: TRANSFER_FLOW_INCLUDE,
      });
    });
  }

  /**
   * D.2 (CP-pos-smart-search) — picker de traslados con L1+L2 heredado.
   *
   * Where tokenizado AND×OR (mismo helper A.1, raíz `products`) + rank en
   * memoria (mismo A.2); `stock_levels.some` @origen intacto. Con
   * kill-switch, sin tokens, sobre scan-cap o throw:
   * el contains legacy, byte-idéntico (fail-open, sin rescate difuso).
   * Shape `{success,data[]}` del controller intacto: aquí no se toca.
   *
   * F-074 guard: `dto/search-transferable-products.dto.ts` es HUÉRFANO (cero
   * importadores; el controller usa @Query sueltos) — documentado, JAMÁS
   * importado ni cableado. No revivirlo aquí.
   */
  // ------------------------------------------------------------------
  // P3 — lecturas de apoyo de la orden avanzada
  // ------------------------------------------------------------------

  private requireOrganizationId(): number {
    const organizationId = RequestContextService.getContext()?.organization_id;
    if (!organizationId) {
      throw new BadRequestException(
        'Elige la organización o tienda desde la que trabajas',
      );
    }
    return organizationId;
  }

  /**
   * Vehículos, conductores, métodos de envío y categorías para la orden
   * avanzada desde la bodega de origen. Usa el mismo cliente y la misma
   * validación de alcance que el despacho, así lo listado es lo que se acepta.
   */
  async getAdvancedOptions(fromLocationId: number) {
    const organizationId = this.requireOrganizationId();
    return this.prisma.$transaction(async (tx) => {
      const scope = await this.validateTransferScope(
        organizationId,
        fromLocationId,
        null,
        tx,
      );
      return listTransferAdvancedOptions(tx, {
        organization_id: organizationId,
        from_store_id: scope.from_store_id,
      });
    });
  }

  /** Lotes de los productos en la bodega de origen, en orden FEFO (D5). */
  async getTransferBatches(fromLocationId: number, productIds: number[]) {
    const organizationId = this.requireOrganizationId();
    return this.prisma.$transaction(async (tx) => {
      await this.validateTransferScope(organizationId, fromLocationId, null, tx);
      return listTransferBatches(tx, {
        organization_id: organizationId,
        location_id: fromLocationId,
        product_ids: productIds,
      });
    });
  }

  /** "Agregar todo el stock de la bodega", con filtro opcional por categoría. */
  async getLocationStock(
    fromLocationId: number,
    toLocationId: number | null,
    categoryId: number | null,
    limit?: number,
    productIds: number[] = [],
  ) {
    const organizationId = this.requireOrganizationId();
    return this.prisma.$transaction(async (tx) => {
      await this.validateTransferScope(
        organizationId,
        fromLocationId,
        toLocationId,
        tx,
      );
      return listTransferLocationStockPage(tx, {
        from_location_id: fromLocationId,
        to_location_id: toLocationId,
        category_id: categoryId,
        product_ids: productIds,
        limit,
      });
    });
  }

  /**
   * Escáner y "pegar lista" (M2): coincidencia exacta por SKU o código de
   * barras del producto o de la variante, con stock en el origen.
   */
  async lookupTransferCode(
    code: string,
    fromLocationId: number,
    toLocationId: number | null,
  ) {
    const organizationId = this.requireOrganizationId();
    return this.prisma.$transaction(async (tx) => {
      await this.validateTransferScope(
        organizationId,
        fromLocationId,
        toLocationId,
        tx,
      );
      return lookupTransferCode(tx, {
        organization_id: organizationId,
        code,
        from_location_id: fromLocationId,
        to_location_id: toLocationId,
      });
    });
  }

  async searchTransferableProducts(
    search: string,
    fromLocationId: number,
    toLocationId: number,
    limit = 10,
  ) {
    const tokens = tokenizeInternal(search);
    // Re-auditoría PR #817 (finding #2): query acentuada (`café`) → legacy.
    // Los tokens plegados (`cafe`) son inmatcheables en `contains`.
    if (
      tokens.length > 0 &&
      !isSearchAccentFolded(search) &&
      (await this.isSmartTransferSearchOn())
    ) {
      try {
        return await this.searchTransferableProductsRanked(
          tokens,
          fromLocationId,
          toLocationId,
          limit,
        );
      } catch (error) {
        this.logger.warn(
          `[TransferSearch] smart→legacy from=${fromLocationId} tokens=${tokens.length}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return this.searchTransferableProductsLegacy(
      search,
      fromLocationId,
      toLocationId,
      limit,
    );
  }

  private async isSmartTransferSearchOn(): Promise<boolean> {
    try {
      if (!this.searchPath) return false;
      return !this.searchPath.isKillSwitchOn();
    } catch {
      return false;
    }
  }

  private async searchTransferableProductsRanked(
    tokens: readonly string[],
    fromLocationId: number,
    toLocationId: number,
    limit: number,
  ) {
    const where = {
      ...buildTokenAndFieldOr(tokens, TRANSFERABLE_SEARCH_FIELDS),
      state: { not: 'archived' },
      stock_levels: {
        some: { location_id: fromLocationId },
      },
    } as Prisma.productsWhereInput;
    const select = {
      id: true,
      name: true,
      sku: true,
      stock_levels: {
        where: {
          location_id: { in: [fromLocationId, toLocationId] },
        },
        select: TRANSFERABLE_STOCK_LEVEL_SELECT,
      },
    } as const;
    const byId = new Map<number, TransferableSearchRow>();
    const outcome = await rankedIdsPage(where, 1, limit, {
      scanCap: TRANSFERABLE_SEARCH_SCAN_CAP,
      scan: async (scanWhere, take) => {
        const rows = (await this.prisma.products.findMany({
          where: scanWhere,
          select,
          take,
        })) as TransferableSearchRow[];
        for (const row of rows) byId.set(row.id, row);
        return rows;
      },
      score: (row) => {
        const breakdown = scoreTokens(
          tokens,
          [
            { key: 'name', value: row.name },
            { key: 'sku', value: row.sku },
          ],
          { primaryKey: 'name' },
        );
        return {
          id: row.id,
          score: breakdown.score,
          coverage: breakdown.coverage,
          featured: false,
          createdAt: 0,
        };
      },
      hydrate: async (_hydrateWhere, pageIds) =>
        pageIds
          .map((id) => byId.get(id))
          .filter(
            (row): row is TransferableSearchRow => row !== undefined,
          ),
      getId: (row) => row.id,
    });
    if (outcome === null) {
      return this.searchTransferableProductsLegacy(
        tokens.join(' '),
        fromLocationId,
        toLocationId,
        limit,
      );
    }
    return outcome.rows.flatMap((p) =>
      this.mapTransferableRow(p, fromLocationId, toLocationId),
    );
  }

  private async searchTransferableProductsLegacy(
    search: string,
    fromLocationId: number,
    toLocationId: number,
    limit = 10,
  ) {
    const products = await this.prisma.products.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ],
        state: { not: 'archived' },
        stock_levels: {
          some: { location_id: fromLocationId },
        },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        stock_levels: {
          where: {
            location_id: { in: [fromLocationId, toLocationId] },
          },
          select: TRANSFERABLE_STOCK_LEVEL_SELECT,
        },
      },
      take: limit,
    });

    return (products as TransferableSearchRow[]).flatMap((p) =>
      this.mapTransferableRow(p, fromLocationId, toLocationId),
    );
  }

  /**
   * Un producto → una fila por variante con stock en el origen (o una sola
   * fila si no maneja variantes). Ver `expandTransferablePickerRows`.
   */
  private mapTransferableRow(
    p: TransferableSearchRow,
    fromLocationId: number,
    toLocationId: number,
  ): TransferablePickerRow[] {
    return expandTransferablePickerRows(
      p,
      p.stock_levels,
      fromLocationId,
      toLocationId,
    );
  }

  /**
   * Borrado duro, y por eso restringido a una transferencia que NUNCA movió
   * stock.
   *
   * Antes borraba cualquier fila sin una sola comprobación: sobre una
   * `in_transit` dejaba las reservas de origen colgadas para siempre (el stock
   * quedaba invisible y no vendible, sin fila que explicara por qué), y sobre
   * una recibida destruía el documento origen del asiento contable que ya se
   * había emitido. Para lo que ya se despachó existe `cancel`, que sí libera.
   */
  async remove(id: number) {
    const stockTransfer = await this.prisma.stock_transfers.findUnique({
      where: { id },
      select: { id: true, status: true, transfer_number: true },
    });

    if (!stockTransfer) {
      throw new NotFoundException(`Transferencia #${id} no encontrada`);
    }

    if (!PENDING_LIKE_STATUSES.includes(stockTransfer.status)) {
      throw new BadRequestException(
        `La transferencia ${stockTransfer.transfer_number} está en estado "${stockTransfer.status}" y no se puede eliminar. Use cancelar para revertirla.`,
      );
    }

    // Cinturón y tirantes: si por cualquier vía quedó una reserva viva, no se
    // borra el documento que la explica.
    const activeReservations = await this.prisma.stock_reservations.count({
      where: {
        reserved_for_type: 'transfer',
        reserved_for_id: id,
        status: 'active',
      },
    });

    if (activeReservations > 0) {
      throw new BadRequestException(
        `La transferencia ${stockTransfer.transfer_number} tiene ${activeReservations} reserva(s) de stock activa(s). Cancélela para liberarlas.`,
      );
    }

    return this.prisma.stock_transfers.delete({
      where: { id },
    });
  }

  private async generateTransferNumber(tx: any): Promise<string> {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const prefix = `TRF-${year}${month}${day}`;

    const lastTransfer = await tx.stock_transfers.findFirst({
      where: {
        transfer_number: {
          startsWith: prefix,
        },
      },
      orderBy: {
        transfer_number: 'desc',
      },
    });

    let sequence = 1;
    if (lastTransfer) {
      const lastSequence = parseInt(lastTransfer.transfer_number.split('-')[2]);
      sequence = lastSequence + 1;
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }
}
