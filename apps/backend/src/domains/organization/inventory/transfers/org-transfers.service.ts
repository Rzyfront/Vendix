import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { transfer_status_enum } from '@prisma/client';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import { StockLevelManager } from '../../../store/inventory/shared/services/stock-level-manager.service';

import { OrgTransferQueryDto } from './dto/org-transfer-query.dto';
import { CreateOrgTransferDto } from './dto/create-org-transfer.dto';
import { CompleteOrgTransferDto } from './dto/complete-org-transfer.dto';
import { CancelOrgTransferDto } from './dto/cancel-org-transfer.dto';
import { DispatchOrgTransferDto } from './dto/dispatch-org-transfer.dto';
import {
  assertStockAvailableAtOrigin,
  assertTransferLines,
  expandTransferablePickerRows,
  type TransferablePickerRow,
} from '../../../store/orders/stock-transfers/transfer-item-rules';
import {
  accumulateTransferReceiptNoteInTx,
  buildDispatchPlan,
  computeNoSupportAlert,
  createTransferNoteInTx,
  dispatchedQuantity,
  hasDeliveryDeadlinePassed,
  noSupportAlertNote,
  isNeverDispatched,
  pendingQuantity,
  requiresDispatchFirst,
  resolveLineBatch,
  resolveTransferNoteStoreId,
  resolveTransferReceiptNoteStoreId,
  resolveTransferTransport,
} from '../../../store/orders/stock-transfers/transfer-transport';
import {
  listTransferAdvancedOptions,
  listTransferBatches,
  listTransferLocationStock,
} from '../../../store/orders/stock-transfers/transfer-advanced-options';
import { VendixHttpException, ErrorCodes } from '@common/errors';

/** Relaciones que devuelven todas las escrituras (mismo shape que `findOne`). */
const TRANSFER_RESPONSE_INCLUDE = {
  from_location: {
    select: { id: true, name: true, code: true, store_id: true },
  },
  to_location: {
    select: { id: true, name: true, code: true, store_id: true },
  },
  stock_transfer_items: {
    include: {
      products: { select: { id: true, name: true, sku: true } },
      product_variants: {
        select: { id: true, name: true, sku: true },
      },
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

/**
 * Org-native stock-transfers service (Plan P2.4 + P4.2 — full lifecycle).
 *
 * --- Lifecycle (after P4 M3 enum migration) ---------------------------------
 *
 *   pending → approved → in_transit → received
 *                                    └──→ cancelled (terminal)
 *
 * Each transition uses dedicated columns instead of the previous
 * discriminator-based logic:
 *
 *   | Logical    | enum value    | Side effects                                  |
 *   |------------|---------------|-----------------------------------------------|
 *   | pending    | `pending`     | none                                          |
 *   | approved   | `approved`    | sets `approved_at`, `approved_by_user_id`     |
 *   | in_transit | `in_transit`  | decrements origin; sets `dispatched_at`,      |
 *   |            |               |   `dispatched_by_user_id`                     |
 *   | received   | `received`    | increments destination per `quantity_received`|
 *   | cancelled  | `cancelled`   | sets `cancelled_at`, `cancelled_by_user_id`,  |
 *   |            |               |   `cancellation_reason`. If was in_transit,   |
 *   |            |               |   returns origin stock                        |
 *
 * --- Backward compat with legacy enum values --------------------------------
 *
 * M3a kept legacy values `draft` and `completed` in `transfer_status_enum` to
 * avoid breaking historical rows (they will be dropped in a follow-up
 * migration once data is fully migrated).
 *
 * Read path (response payloads):
 *   - `'draft'`     → mapped to `'pending'` (or `'approved'` if
 *                     `approved_by_user_id IS NOT NULL`)
 *   - `'completed'` → mapped to `'received'`
 *
 * Write path (state guards):
 *   - We do NOT accept `'draft'` or `'completed'` as the *new* status of any
 *     write. New writes only set `pending|approved|in_transit|received|cancelled`.
 *   - We DO accept `'draft'`/`'completed'` as a valid *transition source* for
 *     legacy rows that pre-date M3 (e.g. approving a `'draft'` row, cancelling
 *     a `'draft'` row, treating a `'completed'` row as terminal). This keeps
 *     legacy data progressable through the new lifecycle without forcing a
 *     bulk data backfill.
 *
 * --- Stock semantics (TWO-STEP, §13#1 of the plan) -----------------------
 *
 *   - `create()`   → no stock change.
 *   - `approve()`  → no stock change. Marks `approved_at` + actor.
 *   - `dispatch()` → decrements origin stock and moves transfer to
 *                    `in_transit`. Marks `dispatched_at` + actor.
 *   - `complete()` → increments destination stock per `quantity_received`
 *                    and (when fully received) emits the accounting event.
 *   - `cancel()`   → if `in_transit`, returns origin stock; otherwise
 *                    just terminates the row. Marks `cancelled_at` + actor +
 *                    `cancellation_reason` (dedicated column, no notes hack).
 */
@Injectable()
export class OrgTransfersService {
  /**
   * Logical states a transfer can be approved/dispatched/cancelled FROM.
   * Includes legacy `'draft'` for pre-M3 rows.
   */
  private static readonly PENDING_LIKE: transfer_status_enum[] = [
    transfer_status_enum.pending,
    transfer_status_enum.draft,
  ];
  /**
   * Terminal states. Legacy `'completed'` is treated as terminal (== received).
   */
  private static readonly TERMINAL_STATES: transfer_status_enum[] = [
    transfer_status_enum.received,
    transfer_status_enum.completed,
    transfer_status_enum.closed_with_loss,
    transfer_status_enum.cancelled,
  ];

  constructor(
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly operatingScope: OperatingScopeService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    return orgId;
  }

  private requireUserId(): number {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new BadRequestException('Authenticated user context required');
    }
    return userId;
  }

  // ------------------------------------------------------------------
  // Reads
  // ------------------------------------------------------------------

  async findAll(query: OrgTransferQueryDto) {
    const organization_id = this.requireOrgId();
    const scoped = await this.orgPrisma.getScopedWhere({
      organization_id,
      store_id_filter: query.store_id ?? null,
    });

    const where: any = {
      ...(query.status != null
        ? { status: this.normalizeStatusFilter(query.status) }
        : {}),
      ...(query.from_location_id != null
        ? { from_location_id: query.from_location_id }
        : {}),
      ...(query.to_location_id != null
        ? { to_location_id: query.to_location_id }
        : {}),
      ...(query.with_alert ? { no_support_alert: true } : {}),
    };

    if (query.transfer_date_from || query.transfer_date_to) {
      where.transfer_date = {};
      if (query.transfer_date_from)
        where.transfer_date.gte = query.transfer_date_from;
      if (query.transfer_date_to)
        where.transfer_date.lte = query.transfer_date_to;
    }

    if (query.search) {
      where.OR = [
        { transfer_number: { contains: query.search } },
        { notes: { contains: query.search } },
      ];
    }

    if (query.product_id) {
      where.stock_transfer_items = {
        some: { product_id: query.product_id },
      };
    }

    // Store breakdown: either side of the transfer touches the requested store.
    if (scoped.store_id != null) {
      const storeFilter = [
        { from_location: { store_id: scoped.store_id } },
        { to_location: { store_id: scoped.store_id } },
      ];
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: storeFilter }];
        delete where.OR;
      } else {
        where.OR = storeFilter;
      }
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 25;
    const skip = (page - 1) * limit;
    const sortBy = query.sort_by ?? 'transfer_date';
    const sortOrder = query.sort_order ?? 'desc';

    const [data, total] = await Promise.all([
      this.orgPrisma.stock_transfers.findMany({
        where,
        include: {
          from_location: {
            select: { id: true, name: true, code: true, store_id: true },
          },
          to_location: {
            select: { id: true, name: true, code: true, store_id: true },
          },
          stock_transfer_items: {
            include: {
              products: { select: { id: true, name: true, sku: true } },
              product_variants: {
                select: { id: true, name: true, sku: true },
              },
            },
          },
        },
        orderBy: { [sortBy]: sortOrder } as any,
        skip,
        take: limit,
      }),
      this.orgPrisma.stock_transfers.count({ where }),
    ]);

    return {
      data: data.map((t: any) => this.mapResponse(t)),
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / Math.max(limit, 1)),
      },
    };
  }

  async findOne(id: number) {
    const organization_id = this.requireOrgId();
    const transfer = await this.orgPrisma.stock_transfers.findFirst({
      where: { id, organization_id },
      include: TRANSFER_RESPONSE_INCLUDE,
    });

    if (!transfer) {
      throw new NotFoundException(`Transfer ${id} not found`);
    }

    return this.mapResponse(transfer);
  }

  /**
   * Aggregate counters for the org-admin dashboard.
   * Counters use the new enum values; legacy rows are folded into their
   * logical equivalents (`draft → pending`, `completed → received`) so the
   * dashboard never shows stale enum names.
   */
  async getStats() {
    const [
      total,
      pendingNew,
      pendingLegacy,
      approved,
      in_transit,
      receivedNew,
      receivedLegacy,
      partiallyReceived,
      cancelled,
      closedWithLoss,
    ] = await Promise.all([
      this.orgPrisma.stock_transfers.count(),
      this.orgPrisma.stock_transfers.count({
        where: { status: transfer_status_enum.pending },
      }),
      this.orgPrisma.stock_transfers.count({
        where: {
          status: transfer_status_enum.draft,
          approved_by_user_id: null,
        },
      }),
      this.orgPrisma.stock_transfers.count({
        where: {
          OR: [
            { status: transfer_status_enum.approved },
            {
              status: transfer_status_enum.draft,
              approved_by_user_id: { not: null },
            },
          ],
        },
      }),
      this.orgPrisma.stock_transfers.count({
        where: { status: transfer_status_enum.in_transit },
      }),
      this.orgPrisma.stock_transfers.count({
        where: { status: transfer_status_enum.received },
      }),
      this.orgPrisma.stock_transfers.count({
        where: { status: transfer_status_enum.completed },
      }),
      this.orgPrisma.stock_transfers.count({
        where: { status: transfer_status_enum.partially_received },
      }),
      this.orgPrisma.stock_transfers.count({
        where: { status: transfer_status_enum.cancelled },
      }),
      this.orgPrisma.stock_transfers.count({
        where: { status: transfer_status_enum.closed_with_loss },
      }),
    ]);

    return {
      total,
      pending: pendingNew + pendingLegacy,
      approved,
      // D4 — una recepción parcial sigue en tránsito: misma tarjeta/filtro.
      in_transit: in_transit + partiallyReceived,
      partially_received: partiallyReceived,
      received: receivedNew + receivedLegacy,
      cancelled,
      closed_with_loss: closedWithLoss,
    };
  }

  // ------------------------------------------------------------------
  // Writes — full lifecycle
  // ------------------------------------------------------------------

  /**
   * Create a transfer in the `pending` state (P4 M3 enum value, default).
   * No stock is moved.
   */
  async create(dto: CreateOrgTransferDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        'At least one transfer item is required',
      );
    }

    const isExternal = dto.is_external_destination === true;
    const toLocationId = isExternal ? null : (dto.to_location_id ?? null);

    if (!isExternal) {
      if (toLocationId == null) {
        throw new BadRequestException('Elige la bodega de destino');
      }
      if (dto.from_location_id === toLocationId) {
        throw new BadRequestException(
          'Source and destination locations must be different',
        );
      }
    } else {
      if (dto.movement_mode !== 'with_dispatch_notes') {
        throw new VendixHttpException(
          ErrorCodes.INV_TRANSFER_EXTERNAL_REQUIRES_DISPATCH_NOTE,
          'Una salida a destino externo solo se registra con remisión: elige el manejo con remisiones',
        );
      }
      if (!dto.external_destination_name?.trim()) {
        throw new BadRequestException(
          'Escribe el nombre del destino externo',
        );
      }
    }

    if (dto.movement_mode === 'quick') {
      throw new BadRequestException(
        'El movimiento rápido se registra desde su propia acción, no como borrador',
      );
    }

    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();
    assertTransferLines(dto.items);

    const scope = await this.validateTransferLocations(
      organization_id,
      dto.from_location_id,
      toLocationId,
    );

    return this.orgPrisma.$transaction(async (tx: any) => {
      const transportResolved = await resolveTransferTransport(tx, dto, {
        organization_id,
        store_id: scope.from_store_id,
        user_id,
      });

      const items: Array<{
        product_id: number;
        product_variant_id?: number | null;
        quantity: number;
        notes?: string | null;
        batch_id: number | null;
      }> = [];
      for (const item of dto.items) {
        items.push({
          product_id: item.product_id,
          product_variant_id: item.product_variant_id ?? null,
          quantity: item.quantity,
          notes: item.notes,
          batch_id: await resolveLineBatch(
            tx,
            item,
            dto.from_location_id,
            item.batch_id ?? null,
            { defaultToFefo: false },
          ),
        });
      }

      const transfer_number = await this.generateTransferNumber(tx);

      const created = await tx.stock_transfers.create({
        data: {
          organization_id,
          transfer_number,
          from_location_id: dto.from_location_id,
          to_location_id: toLocationId,
          status: transfer_status_enum.pending,
          transfer_date: new Date(),
          expected_date: dto.expected_date,
          notes: dto.notes,
          created_by_user_id: user_id,
          movement_mode: (dto.movement_mode as any) ?? null,
          ...transportResolved,
          is_external_destination: isExternal,
          external_destination_name: dto.external_destination_name?.trim() ?? null,
          external_destination_tax_id:
            dto.external_destination_tax_id?.trim() ?? null,
          external_destination_address:
            dto.external_destination_address?.trim() ?? null,
          support_document_type:
            (dto.support_document_type as any) ?? null,
          support_document_id: dto.support_document_id?.trim() ?? null,
          exit_reason: dto.exit_reason?.trim() ?? null,
          no_support_alert: computeNoSupportAlert(dto),
          stock_transfer_items: {
            create: items,
          },
        },
        include: TRANSFER_RESPONSE_INCLUDE,
      });

      return this.mapResponse(created);
    });
  }

  async createAndComplete(dto: CreateOrgTransferDto) {
    // D9 — el movimiento rápido solo opera entre bodegas propias.
    if (dto.is_external_destination) {
      throw new VendixHttpException(
        ErrorCodes.INV_TRANSFER_QUICK_EXTERNAL_FORBIDDEN,
        'El movimiento rápido solo mueve inventario entre tus propias bodegas; para un destino externo usa la orden avanzada',
      );
    }
    if (dto.movement_mode && dto.movement_mode !== 'quick') {
      throw new BadRequestException(
        'El movimiento rápido no admite un modo de orden avanzada',
      );
    }
    if (dto.transport_method && dto.transport_method !== 'none') {
      throw new BadRequestException(
        'El movimiento rápido no registra transporte ni remisión: usa la orden avanzada',
      );
    }
    if (dto.to_location_id == null) {
      throw new BadRequestException('Elige la bodega de destino');
    }
    if (dto.from_location_id === dto.to_location_id) {
      throw new BadRequestException(
        'Source and destination locations must be different',
      );
    }

    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();
    assertTransferLines(dto.items);

    await this.validateTransferLocations(
      organization_id,
      dto.from_location_id,
      dto.to_location_id,
    );

    const result = await this.orgPrisma.$transaction(async (tx: any) => {
      await assertStockAvailableAtOrigin(tx, dto.items, dto.from_location_id);

      const transfer_number = await this.generateTransferNumber(tx);
      const now = new Date();

      const created = await tx.stock_transfers.create({
        data: {
          organization_id,
          transfer_number,
          from_location_id: dto.from_location_id,
          to_location_id: dto.to_location_id,
          status: transfer_status_enum.received,
          transfer_date: now,
          expected_date: dto.expected_date,
          notes: dto.notes,
          created_by_user_id: user_id,
          approved_at: now,
          approved_by_user_id: user_id,
          dispatched_at: now,
          dispatched_by_user_id: user_id,
          completed_date: now,
          movement_mode: 'quick',
          stock_transfer_items: {
            create: dto.items.map((item) => ({
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              quantity: item.quantity,
              quantity_received: item.quantity,
              notes: item.notes,
            })),
          },
        },
        include: { stock_transfer_items: true },
      });

      for (const item of created.stock_transfer_items) {
        const source = await this.stockLevelManager.updateStock(
          {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id: created.from_location_id,
            quantity_change: -item.quantity,
            movement_type: 'transfer',
            reason: `Transfer ${created.transfer_number} - source`,
            user_id,
            create_movement: true,
            from_location_id: created.from_location_id,
            to_location_id: created.to_location_id,
            // Descuento condicional y atómico: un doble envío no puede sacar
            // dos veces las mismas unidades.
            validate_availability: true,
          },
          tx,
        );

        await this.stockLevelManager.updateStock(
          {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id: created.to_location_id,
            quantity_change: item.quantity,
            movement_type: 'transfer',
            reason: `Transfer ${created.transfer_number} - destination`,
            user_id,
            create_movement: true,
            from_location_id: created.from_location_id,
            to_location_id: created.to_location_id,
            unit_cost: Number(source.cost_snapshot?.unit_cost || 0),
          },
          tx,
        );
      }

      return tx.stock_transfers.findUnique({
        where: { id: created.id },
        include: TRANSFER_RESPONSE_INCLUDE,
      });
    });

    const total_cost = await this.calculateTransferTotalCost(
      result.stock_transfer_items,
      result.from_location_id,
    );
    this.eventEmitter.emit('stock_transfer.completed', {
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
      total_cost,
      user_id,
    });

    return this.mapResponse(result);
  }

  /**
   * Picker del movimiento rápido de organización: productos y variantes con
   * stock registrado en el origen, con su disponible en origen y destino. Mismo
   * shape que `GET /store/stock-transfers/search-products` para que el modal
   * compartido no distinga la superficie.
   */
  async searchTransferableProducts(
    search: string,
    fromLocationId: number,
    toLocationId: number,
    limit = 20,
  ): Promise<TransferablePickerRow[]> {
    const organization_id = this.requireOrgId();
    await this.operatingScope.enforceLocationAccess(
      organization_id,
      fromLocationId,
      { allowCentral: true },
    );
    await this.operatingScope.enforceLocationAccess(
      organization_id,
      toLocationId,
      { allowCentral: true },
    );

    const term = (search ?? '').trim();
    const take = Math.min(Math.max(Number(limit) || 20, 1), 50);

    const originRows = await this.orgPrisma.stock_levels.findMany({
      where: {
        location_id: fromLocationId,
        products: { state: { not: 'archived' } },
        ...(term
          ? {
              OR: [
                { products: { name: { contains: term, mode: 'insensitive' } } },
                { products: { sku: { contains: term, mode: 'insensitive' } } },
                {
                  product_variants: {
                    name: { contains: term, mode: 'insensitive' },
                  },
                },
                {
                  product_variants: {
                    sku: { contains: term, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        product_id: true,
        product_variant_id: true,
        location_id: true,
        quantity_on_hand: true,
        quantity_reserved: true,
        quantity_available: true,
        products: { select: { id: true, name: true, sku: true } },
        product_variants: { select: { id: true, name: true, sku: true } },
      },
      orderBy: [{ quantity_available: 'desc' }, { id: 'asc' }],
      take,
    });

    if (originRows.length === 0) return [];

    const productIds = [...new Set(originRows.map((r: any) => r.product_id))];
    const destinationRows = await this.orgPrisma.stock_levels.findMany({
      where: { location_id: toLocationId, product_id: { in: productIds } },
      select: {
        product_id: true,
        product_variant_id: true,
        location_id: true,
        quantity_on_hand: true,
        quantity_reserved: true,
        quantity_available: true,
      },
    });

    // Productos que ya llevan su stock por variante en el origen: su fila base
    // vacía es un residuo y no se ofrece (misma regla que el picker de tienda).
    const productsWithVariantRows = new Set(
      originRows
        .filter((r: any) => r.product_variant_id != null)
        .map((r: any) => r.product_id),
    );

    // Se conserva el orden del origen (más disponible primero); cada fila de
    // origen es exactamente una fila del picker.
    return originRows
      .filter(
        (row: any) =>
          row.product_variant_id != null ||
          !productsWithVariantRows.has(row.product_id) ||
          Number(row.quantity_on_hand ?? 0) > 0,
      )
      .flatMap((row: any) =>
        expandTransferablePickerRows(
          row.products ?? {
            id: row.product_id,
            name: `Producto #${row.product_id}`,
            sku: null,
          },
          [
            row,
            ...destinationRows.filter(
              (d: any) => d.product_id === row.product_id,
            ),
          ],
          fromLocationId,
          toLocationId,
        ),
      );
  }

  // ------------------------------------------------------------------
  // P3 — lecturas de apoyo de la orden avanzada (mismas que en tienda)
  // ------------------------------------------------------------------

  /** Vehículos, conductores, métodos de envío y categorías del origen (D6). */
  async getAdvancedOptions(fromLocationId: number) {
    const organization_id = this.requireOrgId();
    const scope = await this.validateTransferLocations(
      organization_id,
      fromLocationId,
      null,
    );
    return this.orgPrisma.$transaction((tx: any) =>
      listTransferAdvancedOptions(tx, {
        organization_id,
        from_store_id: scope.from_store_id,
      }),
    );
  }

  /** Lotes de los productos en la bodega de origen, en orden FEFO (D5). */
  async getTransferBatches(fromLocationId: number, productIds: number[]) {
    const organization_id = this.requireOrgId();
    await this.validateTransferLocations(organization_id, fromLocationId, null);
    return this.orgPrisma.$transaction((tx: any) =>
      listTransferBatches(tx, {
        location_id: fromLocationId,
        product_ids: productIds,
      }),
    );
  }

  /** "Agregar todo el stock de la bodega", con filtro opcional por categoría. */
  async getLocationStock(
    fromLocationId: number,
    toLocationId: number | null,
    categoryId: number | null,
    limit?: number,
  ) {
    const organization_id = this.requireOrgId();
    await this.validateTransferLocations(
      organization_id,
      fromLocationId,
      toLocationId,
    );
    return this.orgPrisma.$transaction((tx: any) =>
      listTransferLocationStock(tx, {
        from_location_id: fromLocationId,
        to_location_id: toLocationId,
        category_id: categoryId,
        limit,
      }),
    );
  }

  /**
   * `pending → approved` transition.
   *
   * No stock is moved (TWO-STEP approve+dispatch, §13#1).
   * Sets dedicated columns: `status='approved'`, `approved_at`, `approved_by_user_id`.
   * Backward compat: legacy rows with `status='draft'` are accepted as the
   * source state.
   */
  async approve(id: number) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    const transfer = await this.orgPrisma.stock_transfers.findFirst({
      where: { id, organization_id },
    });
    if (!transfer) {
      throw new NotFoundException(`Transfer ${id} not found`);
    }

    if (
      !OrgTransfersService.PENDING_LIKE.includes(transfer.status as any)
    ) {
      throw new BadRequestException(
        `Cannot approve transfer in status '${transfer.status}'`,
      );
    }

    if (transfer.approved_by_user_id != null) {
      throw new ConflictException('Transfer is already approved');
    }

    const updated = await this.orgPrisma.stock_transfers.update({
      where: { id },
      data: {
        status: transfer_status_enum.approved,
        approved_at: new Date(),
        approved_by_user_id: user_id,
      },
      include: {
        from_location: {
          select: { id: true, name: true, code: true, store_id: true },
        },
        to_location: {
          select: { id: true, name: true, code: true, store_id: true },
        },
        stock_transfer_items: {
          include: {
            products: { select: { id: true, name: true, sku: true } },
            product_variants: {
              select: { id: true, name: true, sku: true },
            },
          },
        },
      },
    });

    return this.mapResponse(updated);
  }

  /**
   * `approved → in_transit` transition.
   *
   * Decrements origin stock for every item.
   * Sets `dispatched_at`, `dispatched_by_user_id`.
   * Backward compat: a legacy row in `'draft'` with `approved_by_user_id IS
   * NOT NULL` is treated as logically `approved` and accepted as the source
   * state.
   */
  /**
   * `approved → in_transit` (D3): descuenta el origen, guarda el conteo de
   * salida por línea, el lote (D5), el transporte/costo (D6) y crea la remisión
   * `transfer_out` dentro de la misma transacción cuando el modo es
   * `with_dispatch_notes`.
   *
   * - `mass_only`: suma en destino y cierra como `received` sin remisión.
   * - destino externo (D8): solo salida; queda `completed` porque no hay
   *   bodega que reciba.
   * - sin modo (filas históricas): queda en tránsito, como antes.
   */
  async dispatch(id: number, dto: DispatchOrgTransferDto = {}) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    const outcome = await this.orgPrisma.$transaction(async (tx: any) => {
      const transfer = await tx.stock_transfers.findFirst({
        where: { id, organization_id },
        include: { stock_transfer_items: true },
      });
      if (!transfer) {
        throw new NotFoundException(`Transfer ${id} not found`);
      }

      const isApproved =
        transfer.status === transfer_status_enum.approved ||
        (transfer.status === transfer_status_enum.draft &&
          transfer.approved_by_user_id != null);

      if (!isApproved) {
        throw new BadRequestException(
          `Cannot dispatch transfer in status '${transfer.status}'. ` +
            `Transfer must be approved first.`,
        );
      }

      if (transfer.movement_mode === 'quick') {
        throw new BadRequestException(
          'Esta transferencia es un movimiento rápido: el inventario ya se movió',
        );
      }

      // Reclamo atómico: dos despachos simultáneos compiten por la misma fila;
      // el segundo no vuelve a descontar stock.
      // El estado va en la condición: un cancelar concurrente que ya cambió la
      // fila hace que este reclamo no encuentre nada que despachar.
      const claim = await tx.stock_transfers.updateMany({
        where: {
          id,
          organization_id,
          dispatched_at: null,
          status: {
            in: [transfer_status_enum.approved, transfer_status_enum.draft],
          },
        },
        data: { dispatched_at: new Date(), dispatched_by_user_id: user_id },
      });
      if (claim.count === 0) {
        throw new ConflictException(
          `La transferencia ${transfer.transfer_number} ya fue despachada`,
        );
      }

      if (
        transfer.dispatched_at != null ||
        transfer.stock_transfer_items.some(
          (item: any) => item.quantity_dispatched != null,
        )
      ) {
        throw new ConflictException(
          `La transferencia ${transfer.transfer_number} ya fue despachada`,
        );
      }

      const isExternal = transfer.is_external_destination === true;
      if (isExternal) {
        if (transfer.movement_mode !== 'with_dispatch_notes') {
          throw new VendixHttpException(
            ErrorCodes.INV_TRANSFER_EXTERNAL_REQUIRES_DISPATCH_NOTE,
            'Una salida a destino externo necesita remisión',
          );
        }
      } else if (transfer.to_location_id == null) {
        throw new BadRequestException(
          'La transferencia no tiene bodega de destino',
        );
      }

      const scope = await this.validateTransferLocations(
        organization_id,
        transfer.from_location_id,
        transfer.to_location_id,
      );

      const plan = buildDispatchPlan(
        transfer.stock_transfer_items,
        dto.items,
      );

      await assertStockAvailableAtOrigin(
        tx,
        plan
          .filter((entry) => entry.quantity_dispatched > 0)
          .map((entry) => ({
            product_id: entry.line.product_id,
            product_variant_id: entry.line.product_variant_id,
            quantity: entry.quantity_dispatched,
          })),
        transfer.from_location_id,
      );

      const batchNumbers = new Map<number, string>();
      for (const entry of plan) {
        if (entry.quantity_dispatched <= 0) continue;
        entry.batch_id = await resolveLineBatch(
          tx,
          entry.line,
          transfer.from_location_id,
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
      // trae un método. Sin `transport_method` las columnas no se tocan.
      const transport =
        dto.transport_method !== undefined
          ? await resolveTransferTransport(tx, dto, {
              organization_id,
              store_id: scope.from_store_id,
              user_id,
            })
          : {};

      const wantsDispatchNote =
        transfer.movement_mode === 'with_dispatch_notes' || isExternal;
      let dispatchNoteId: number | null = transfer.dispatch_note_id ?? null;

      if (wantsDispatchNote) {
        const note = await createTransferNoteInTx(tx, {
          store_id: resolveTransferNoteStoreId(
            scope.from_store_id,
            scope.to_store_id,
          ),
          direction: 'outbound',
          subtype: 'transfer_out',
          from_location_id: transfer.from_location_id,
          to_location_id: transfer.to_location_id,
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
          notes: `Remisión de salida de la transferencia ${transfer.transfer_number}`,
          internal_notes: transfer.no_support_alert
            ? noSupportAlertNote()
            : null,
          external: isExternal
            ? {
                name: transfer.external_destination_name,
                tax_id: transfer.external_destination_tax_id,
                address: transfer.external_destination_address,
              }
            : null,
          user_id,
        });
        dispatchNoteId = note.id;
      }

      const sourceCosts = new Map<number, number>();
      for (const entry of plan) {
        // Toda línea del plan deja su conteo de salida, incluido el 0: NULL se
        // lee como "salió completa" (fila histórica) y recibir, cancelar o
        // cerrar con pérdida operarían sobre unidades que nunca salieron.
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
            location_id: transfer.from_location_id,
            quantity_change: -entry.quantity_dispatched,
            movement_type: 'transfer',
            reason: `Transfer ${transfer.transfer_number} dispatched`,
            user_id,
            create_movement: true,
            validate_availability: true,
            from_location_id: transfer.from_location_id,
            to_location_id: transfer.to_location_id ?? undefined,
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
      }

      const now = new Date();
      let status: transfer_status_enum = transfer_status_enum.in_transit;
      let completedDate: Date | null = null;
      let totalCost = 0;

      if (isExternal) {
        status = transfer_status_enum.completed;
        completedDate = now;
        totalCost = plan.reduce(
          (sum, entry) =>
            sum +
            (sourceCosts.get(entry.line.id) ?? 0) *
              entry.quantity_dispatched,
          0,
        );
      } else if (transfer.movement_mode === 'mass_only') {
        for (const entry of plan) {
          if (entry.quantity_dispatched <= 0) continue;
          const unitCost = sourceCosts.get(entry.line.id) ?? 0;
          await this.stockLevelManager.updateStock(
            {
              product_id: entry.line.product_id,
              variant_id: entry.line.product_variant_id ?? undefined,
              location_id: transfer.to_location_id as number,
              quantity_change: entry.quantity_dispatched,
              movement_type: 'transfer',
              reason: `Transfer ${transfer.transfer_number} received`,
              user_id,
              create_movement: true,
              from_location_id: transfer.from_location_id,
              to_location_id: transfer.to_location_id ?? undefined,
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

      const mergedNotes = this.mergeNotes(transfer.notes, dto?.notes);

      const updated = await tx.stock_transfers.update({
        where: { id },
        data: {
          ...transport,
          dispatch_note_id: dispatchNoteId,
          status,
          completed_date: completedDate,
          dispatched_at: now,
          dispatched_by_user_id: user_id,
          ...(mergedNotes !== transfer.notes ? { notes: mergedNotes } : {}),
        },
        include: TRANSFER_RESPONSE_INCLUDE,
      });

      return { transfer: updated, totalCost, status };
    });

    // Una salida externa no tiene destino interno: no se emite el asiento de
    // traslado (el listener contable espera un `to_location_id` numérico).
    if (
      (outcome.status === transfer_status_enum.received ||
        outcome.status === transfer_status_enum.completed) &&
      outcome.transfer.to_location_id != null
    ) {
      await this.emitCompleted(outcome.transfer, outcome.totalCost, user_id);
    }

    return this.mapResponse(outcome.transfer);
  }

  /**
   * Recepción repetible (D4): suma al destino solo lo que llega en esta
   * llamada. Con saldo pendiente queda `partially_received`; al completarse,
   * `received`. Si la transferencia nunca se despachó (fila histórica), el
   * origen se descuenta acá, como hacía el flujo anterior.
   */
  async receive(
    id: number,
    dto: CompleteOrgTransferDto,
  ) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        'At least one received item is required',
      );
    }

    const outcome = await this.orgPrisma.$transaction(async (tx: any) => {
      // Serializa recepciones simultáneas: la segunda lee el saldo ya
      // actualizado por la primera y no suma dos veces las mismas unidades.
      await tx.stock_transfers.updateMany({
        where: { id, organization_id },
        data: { updated_at: new Date() },
      });

      const transfer = await tx.stock_transfers.findFirst({
        where: { id, organization_id },
        include: { stock_transfer_items: true },
      });
      if (!transfer) {
        throw new NotFoundException(`Transfer ${id} not found`);
      }

      if (transfer.is_external_destination) {
        throw new BadRequestException(
          'Una salida a destino externo no se recibe: se cierra al despachar',
        );
      }
      if (transfer.to_location_id == null) {
        throw new BadRequestException(
          'La transferencia no tiene bodega de destino',
        );
      }
      if (
        transfer.status !== transfer_status_enum.in_transit &&
        transfer.status !== transfer_status_enum.partially_received
      ) {
        throw new BadRequestException(
          `Cannot complete transfer in status '${transfer.status}'. ` +
            `Transfer must be in_transit first.`,
        );
      }
      if (requiresDispatchFirst(transfer)) {
        throw new BadRequestException(
          'Despacha la transferencia antes de recibirla',
        );
      }

      const linesById = new Map<number, any>(
        transfer.stock_transfer_items.map((line: any) => [line.id, line]),
      );
      const seen = new Set<number>();
      const normalized: Array<{ line: any; quantity: number }> = [];

      for (const received of dto.items) {
        if (seen.has(received.stock_transfer_item_id)) {
          throw new BadRequestException(
            `La línea #${received.stock_transfer_item_id} está repetida en la recepción`,
          );
        }
        seen.add(received.stock_transfer_item_id);
        const line = linesById.get(received.stock_transfer_item_id);
        if (!line) {
          throw new BadRequestException(
            `Item ${received.stock_transfer_item_id} does not belong to transfer ${id}`,
          );
        }
        const pending = pendingQuantity(line);
        if (received.quantity_received > pending) {
          throw new BadRequestException(
            `quantity_received (${received.quantity_received}) for item ${line.id} exceeds remaining ${pending}`,
          );
        }
        normalized.push({
          line,
          quantity: Number(received.quantity_received),
        });
      }

      const toReceive = normalized.filter((entry) => entry.quantity > 0);
      if (toReceive.length === 0) {
        throw new BadRequestException(
          'Escribe al menos una cantidad recibida mayor que cero',
        );
      }

      // Solo filas sin modo de movimiento llegan acá sin despacho: un modo
      // avanzado sin despacho ya se rechazó arriba.
      const legacyUndispatched = isNeverDispatched(transfer);

      // Flujo histórico: una transferencia aprobada desde la tienda reservó el
      // origen. Se consume la reserva antes de descontar (igual que la tienda);
      // sin reservas activas esto no hace nada.
      if (legacyUndispatched) {
        await this.stockLevelManager.releaseReservationsByReference(
          'transfer',
          transfer.id,
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
          transfer.from_location_id,
        );

        if (legacyUndispatched) {
          const source = await this.stockLevelManager.updateStock(
            {
              product_id: line.product_id,
              variant_id: line.product_variant_id ?? undefined,
              location_id: transfer.from_location_id,
              quantity_change: -entry.quantity,
              movement_type: 'transfer',
              reason: `Transfer ${transfer.transfer_number} dispatched`,
              user_id,
              create_movement: true,
              from_location_id: transfer.from_location_id,
              to_location_id: transfer.to_location_id ?? undefined,
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
            location_id: transfer.to_location_id as number,
            quantity_change: entry.quantity,
            movement_type: 'transfer',
            reason: `Transfer ${transfer.transfer_number} received`,
            user_id,
            create_movement: true,
            from_location_id: transfer.from_location_id,
            to_location_id: transfer.to_location_id ?? undefined,
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
      }

      const scope = await this.validateTransferLocations(
        organization_id,
        transfer.from_location_id,
        transfer.to_location_id,
      );

      let receiptNoteId = transfer.receipt_note_id ?? null;
      if (transfer.movement_mode === 'with_dispatch_notes') {
        // La remisión de entrada queda en la tienda que recibe.
        receiptNoteId = await accumulateTransferReceiptNoteInTx(tx, {
          existing_note_id: receiptNoteId,
          store_id: resolveTransferReceiptNoteStoreId(
            scope.from_store_id,
            scope.to_store_id,
          ),
          direction: 'inbound',
          subtype: 'transfer_in',
          from_location_id: transfer.from_location_id,
          to_location_id: transfer.to_location_id,
          items: toReceive.map((entry) => ({
            product_id: entry.line.product_id,
            product_variant_id: entry.line.product_variant_id,
            quantity: entry.quantity,
          })),
          notes: `Remisión de entrada de la transferencia ${transfer.transfer_number}`,
          user_id,
        });
      }

      const refreshed = await tx.stock_transfer_items.findMany({
        where: { stock_transfer_id: id },
      });
      const fullyReceived = refreshed.every(
        (line: any) => line.quantity_received >= dispatchedQuantity(line),
      );

      const mergedNotes = this.mergeNotes(transfer.notes, dto.notes);

      const updated = await tx.stock_transfers.update({
        where: { id },
        data: {
          status: fullyReceived
            ? transfer_status_enum.received
            : transfer_status_enum.partially_received,
          completed_date: fullyReceived ? new Date() : null,
          receipt_note_id: receiptNoteId,
          ...(mergedNotes !== transfer.notes ? { notes: mergedNotes } : {}),
        },
        include: TRANSFER_RESPONSE_INCLUDE,
      });

      return { transfer: updated, fullyReceived };
    });

    if (outcome.fullyReceived) {
      const totalCost = await this.calculateTransferTotalCost(
        outcome.transfer.stock_transfer_items,
        outcome.transfer.from_location_id,
      );
      await this.emitCompleted(outcome.transfer, totalCost, user_id);
    }

    return this.mapResponse(outcome.transfer);
  }

  /** Compatibilidad: `complete` es el nombre histórico de `receive`. */
  async complete(id: number, dto: CompleteOrgTransferDto) {
    return this.receive(id, dto);
  }

  /**
   * D4 — cierre del saldo pendiente como pérdida. Solo con la fecha límite de
   * entrega vencida y motivo obligatorio. Si ya se despachó, las unidades
   * salieron del origen en el despacho: acá solo se registran como pérdida
   * (`quantity_lost`) para no descontar dos veces. Si nunca se despachó, se
   * crea el movimiento de merma en el origen.
   */
  async closeWithLoss(
    id: number,
    reasonInput: string,
    notes?: string,
  ) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    return this.orgPrisma.$transaction(async (tx: any) => {
      // Mismo candado de fila que `receive`: recepción y cierre simultáneos
      // se serializan y el segundo lee saldo y estado ya actualizados.
      await tx.stock_transfers.updateMany({
        where: { id, organization_id },
        data: { updated_at: new Date() },
      });

      const transfer = await tx.stock_transfers.findFirst({
        where: { id, organization_id },
        include: { stock_transfer_items: true },
      });
      if (!transfer) {
        throw new NotFoundException(`Transfer ${id} not found`);
      }

      if (transfer.is_external_destination) {
        throw new BadRequestException(
          'Una salida a destino externo se cierra al despachar: no tiene saldo pendiente',
        );
      }

      if (
        transfer.status !== transfer_status_enum.in_transit &&
        transfer.status !== transfer_status_enum.partially_received
      ) {
        throw new BadRequestException(
          'Solo una transferencia despachada con saldo pendiente puede cerrarse como pérdida',
        );
      }
      if (requiresDispatchFirst(transfer)) {
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

      if (!transfer.expected_date) {
        throw new BadRequestException(
          'La transferencia no tiene fecha límite de entrega: agrega una antes de cerrar la pérdida',
        );
      }

      if (!hasDeliveryDeadlinePassed(transfer.expected_date)) {
        throw new VendixHttpException(
          ErrorCodes.INV_TRANSFER_LOSS_NOT_DUE,
          'Todavía no vence la fecha límite de entrega: podrás cerrar la pérdida después de esa fecha',
        );
      }

      const pendingLines = transfer.stock_transfer_items
        .map((line: any) => ({ line, pending: pendingQuantity(line) }))
        .filter((entry: any) => entry.pending > 0);

      if (pendingLines.length === 0) {
        throw new BadRequestException(
          'No hay saldo pendiente: la transferencia ya está completa',
        );
      }

      const legacyUndispatched = isNeverDispatched(transfer);

      if (legacyUndispatched) {
        // La reserva del aprobar de tienda se consume antes de la merma.
        await this.stockLevelManager.releaseReservationsByReference(
          'transfer',
          transfer.id,
          'consumed',
          tx,
          { decrementOnHand: false },
        );
        for (const entry of pendingLines) {
          await this.stockLevelManager.updateStock(
            {
              product_id: entry.line.product_id,
              variant_id: entry.line.product_variant_id ?? undefined,
              location_id: transfer.from_location_id,
              quantity_change: -entry.pending,
              movement_type: 'damage',
              reason: `Merma de transferencia ${transfer.transfer_number}: ${reason}`,
              user_id,
              create_movement: true,
              validate_availability: true,
              from_location_id: transfer.from_location_id,
              to_location_id: transfer.to_location_id ?? undefined,
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

      const mergedNotes = this.mergeNotes(transfer.notes, notes);

      const updated = await tx.stock_transfers.update({
        where: { id },
        data: {
          status: transfer_status_enum.closed_with_loss,
          loss_closed_at: new Date(),
          loss_closed_by_user_id: user_id,
          loss_reason: reason,
          ...(mergedNotes !== transfer.notes ? { notes: mergedNotes } : {}),
        },
        include: TRANSFER_RESPONSE_INCLUDE,
      });

      return this.mapResponse(updated);
    });
  }

  /**
   * Cancel a transfer.
   *
   * - `pending`/`approved` (or legacy `draft`) → just mark `cancelled`.
   * - `in_transit`/`partially_received` → return the pending quantity (lo
   *   despachado y no recibido) to the origin and mark `cancelled`.
   * - `received`/`completed`/`closed_with_loss`/`cancelled` → not allowed.
   */
  async cancel(id: number, dto: CancelOrgTransferDto) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    const updated = await this.orgPrisma.$transaction(async (tx: any) => {
      // Candado de fila condicionado por estado (mismo patrón que el reclamo
      // del despacho): una recepción, un despacho o un cierre concurrentes se
      // serializan con esta cancelación, y la lectura se hace DESPUÉS del
      // candado y dentro de la transacción. Así no se devuelve al origen lo
      // que otra operación acaba de recibir en destino ni se cancela sin
      // devolución algo que se acaba de despachar.
      const lock = await tx.stock_transfers.updateMany({
        where: {
          id,
          organization_id,
          status: { notIn: OrgTransfersService.TERMINAL_STATES },
        },
        data: { updated_at: new Date() },
      });

      const transfer = await tx.stock_transfers.findFirst({
        where: { id, organization_id },
        include: { stock_transfer_items: true },
      });
      if (!transfer) {
        throw new NotFoundException(`Transfer ${id} not found`);
      }

      if (
        OrgTransfersService.TERMINAL_STATES.includes(transfer.status as any)
      ) {
        throw new BadRequestException(
          `Cannot cancel transfer in status '${transfer.status}'`,
        );
      }
      if (lock.count === 0) {
        throw new ConflictException(
          `La transferencia ${transfer.transfer_number} cambió mientras se cancelaba: actualiza e intenta de nuevo`,
        );
      }

      const cancelledData = {
        status: transfer_status_enum.cancelled,
        cancelled_at: new Date(),
        cancelled_by_user_id: user_id,
        cancellation_reason: dto?.reason ?? null,
      };

      // pending / approved / legacy draft → just terminate, no stock movement.
      if (
        transfer.status !== transfer_status_enum.in_transit &&
        transfer.status !== transfer_status_enum.partially_received
      ) {
        return tx.stock_transfers.update({
          where: { id },
          data: cancelledData,
          include: TRANSFER_RESPONSE_INCLUDE,
        });
      }

      // Flujo histórico (aprobada desde la tienda, nunca despachada): el
      // origen no se descontó, solo se reservó. Se libera la reserva y no se
      // devuelve nada, igual que la tienda; devolver crearía stock fantasma.
      if (isNeverDispatched(transfer)) {
        await this.stockLevelManager.releaseReservationsByReference(
          'transfer',
          transfer.id,
          'cancelled',
          tx,
        );
        return tx.stock_transfers.update({
          where: { id },
          data: cancelledData,
          include: TRANSFER_RESPONSE_INCLUDE,
        });
      }

      // Devuelve al origen lo pendiente (despachado y no recibido).
      for (const item of transfer.stock_transfer_items) {
        const pending = pendingQuantity(item);
        if (pending <= 0) continue;
        await this.stockLevelManager.updateStock(
          {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id: transfer.from_location_id,
            quantity_change: pending,
            movement_type: 'transfer',
            reason:
              dto?.reason ??
              `Transfer ${transfer.transfer_number} cancelled — return to origin`,
            user_id,
            create_movement: true,
            from_location_id: transfer.from_location_id,
            to_location_id: transfer.to_location_id ?? undefined,
          },
          tx,
        );
      }

      return tx.stock_transfers.update({
        where: { id },
        data: cancelledData,
        include: TRANSFER_RESPONSE_INCLUDE,
      });
    });

    return this.mapResponse(updated);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Pertenencia de ambas ubicaciones a la organización (bodega central
   * permitida) y política de traslado entre tiendas. Compartido por `create` y
   * `createAndComplete`.
   */
  private async validateTransferLocations(
    organization_id: number,
    fromLocationId: number,
    toLocationId: number | null,
  ): Promise<{ from_store_id: number | null; to_store_id: number | null }> {
    const fromLocation = await this.operatingScope.enforceLocationAccess(
      organization_id,
      fromLocationId,
      { allowCentral: true },
    );

    // D8 — un destino externo no tiene bodega que validar.
    if (toLocationId == null) {
      return {
        from_store_id: fromLocation.store_id ?? null,
        to_store_id: null,
      };
    }

    const toLocation = await this.operatingScope.enforceLocationAccess(
      organization_id,
      toLocationId,
      { allowCentral: true },
    );

    // Cross-store guard. Only matters when both locations resolve to a
    // store_id; central warehouses (store_id null) are intra-org by design.
    if (
      fromLocation.store_id != null &&
      toLocation.store_id != null &&
      fromLocation.store_id !== toLocation.store_id
    ) {
      await this.operatingScope.assertCrossStoreTransferAllowed(
        organization_id,
        fromLocation.store_id,
        toLocation.store_id,
      );
    }

    return {
      from_store_id: fromLocation.store_id ?? null,
      to_store_id: toLocation.store_id ?? null,
    };
  }

  /**
   * Maps a legacy enum filter value to the equivalent set of physical values
   * for backward compat with old clients (e.g. UI tabs that still send
   * `'draft'` or `'completed'`).
   */
  private normalizeStatusFilter(
    status: string,
  ):
    | transfer_status_enum
    | { in: transfer_status_enum[] } {
    switch (status) {
      // Legacy alias for the old "draft" tab — maps to current `pending`
      // plus any legacy rows that are still physically `draft`.
      case 'draft':
        return {
          in: [transfer_status_enum.pending, transfer_status_enum.draft],
        };
      // Legacy alias for the old "completed" tab — maps to current
      // `received` plus any legacy rows that are still physically
      // `completed`.
      case 'completed':
        return {
          in: [transfer_status_enum.received, transfer_status_enum.completed],
        };
      // D4 — "En tránsito" incluye las recepciones parciales, que siguen con
      // saldo en camino.
      case 'in_transit':
        return {
          in: [
            transfer_status_enum.in_transit,
            transfer_status_enum.partially_received,
          ],
        };
      case 'partially_received':
        return { in: [transfer_status_enum.partially_received] };
      default:
        return status as transfer_status_enum;
    }
  }

  /**
   * Folds a row's physical enum value into the canonical logical state
   * exposed in API responses. Keeps the public contract stable while
   * legacy rows linger.
   */
  private toLogicalStatus(row: {
    status: transfer_status_enum;
    approved_by_user_id?: number | null;
    is_external_destination?: boolean | null;
  }): transfer_status_enum {
    if (row.status === transfer_status_enum.draft) {
      return row.approved_by_user_id != null
        ? transfer_status_enum.approved
        : transfer_status_enum.pending;
    }
    if (row.status === transfer_status_enum.completed) {
      // Una salida externa (D8) termina en `completed` y NO es una recepción:
      // se conserva el estado para que no se cuente como mercancía recibida.
      return row.is_external_destination
        ? transfer_status_enum.completed
        : transfer_status_enum.received;
    }
    return row.status;
  }

  private mapResponse<T extends { status: transfer_status_enum }>(row: T): T {
    return { ...row, status: this.toLogicalStatus(row as any) };
  }

  private mergeNotes(
    existing: string | null | undefined,
    addition: string | null | undefined,
  ): string | null {
    if (!addition) return existing ?? null;
    if (!existing) return addition;
    return `${existing}\n${addition}`;
  }

  /**
   * Costo unitario con el que sale una línea del origen (mismo criterio que
   * `calculateTransferTotalCost`: CPP → variante → producto).
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

  /** Evento contable de una transferencia que terminó de moverse. */
  private async emitCompleted(
    transfer: any,
    totalCost: number,
    user_id: number,
  ): Promise<void> {
    this.eventEmitter.emit('stock_transfer.completed', {
      transfer_id: transfer.id,
      transfer_number: transfer.transfer_number,
      organization_id: transfer.organization_id,
      store_id:
        transfer.from_location?.store_id === transfer.to_location?.store_id
          ? transfer.from_location?.store_id
          : undefined,
      from_store_id: transfer.from_location?.store_id ?? undefined,
      to_store_id: transfer.to_location?.store_id ?? undefined,
      from_location_id: transfer.from_location_id,
      to_location_id: transfer.to_location_id,
      total_cost: totalCost,
      user_id,
    });
  }

  private async calculateTransferTotalCost(
    items: any[],
    fromLocationId: number,
  ): Promise<number> {
    let total = 0;
    for (const item of items) {
      const qty = Number(item.quantity_received || 0);
      if (qty <= 0) continue;

      const stockLevel = await this.orgPrisma.stock_levels.findFirst({
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
      total += qty * unitCost;
    }
    return total;
  }

  /**
   * Generate the next sequential transfer number with the same shape used
   * by the store-domain service: `TRF-YYYYMMDD-NNNN` (per org because the
   * unique key is `(organization_id, transfer_number)`).
   */
  private async generateTransferNumber(tx: any): Promise<string> {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const prefix = `TRF-${year}${month}${day}`;

    const lastTransfer = await tx.stock_transfers.findFirst({
      where: { transfer_number: { startsWith: prefix } },
      orderBy: { transfer_number: 'desc' },
    });

    let sequence = 1;
    if (lastTransfer) {
      const parts = lastTransfer.transfer_number.split('-');
      const last = parseInt(parts[2], 10);
      if (Number.isFinite(last)) sequence = last + 1;
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }
}
