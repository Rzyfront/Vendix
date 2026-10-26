import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { AuditService, AuditResource } from '@common/audit/audit.service';
import { storeIsRestaurant } from '@common/helpers/industry-capabilities.helper';
import {
  OrderFlowService,
  OrderItemCancelEffects,
} from '../order-flow/order-flow.service';
import { OrdersService, PlannedOrderLine } from '../orders.service';
import { OrderSseService } from '../services/order-sse.service';
import { assertNoActiveFinancialSplit } from '../shared/financial-split-policy';
import { assertVariantRequiredForPrepared } from '../utils/variant-required.validator';
import {
  FullTaxRow,
  resolveCatalogLine,
  resolveCatalogUnitPrice,
  resolveFullTaxRowsByProductId,
} from '../utils/catalog-line-pricing.util';
import { createHash } from 'crypto';
import {
  roundMoney2,
  resolveLineUnits,
  resolveOrderLineTaxTotal,
} from '../../taxes/utils/final-price.util';
import { KitchenFireService } from '../../kitchen-fire/kitchen-fire.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import {
  StockValidatorService,
  StockDemandLine,
  InsufficientStockItem,
} from '../../inventory/shared/services/stock-validator.service';
import { SellableStockAllocator } from '../../inventory/shared/services/sellable-stock-allocator.service';
import { PromotionEngineService } from '../../promotions/promotion-engine/promotion-engine.service';
import { CouponsService } from '../../coupons/coupons.service';
import { OrderItemChangesDto } from './dto/order-item-changes.dto';

type Client = Prisma.TransactionClient | StorePrismaService;

export type ItemChangeKitchenStatus =
  | 'none'
  | 'pending'
  | 'in_preparation'
  | 'ready'
  | 'delivered';
export type ItemChangeKitchenEffect = 'none' | 'fire' | 'cancel_ticket_item';
export type ItemChangeStockEffect =
  | 'none'
  | 'reserve'
  | 'release'
  | 'ingredients_reused'
  | 'ingredients_wasted'
  | 'ingredients_consumed';

export interface ItemChangesTotals {
  subtotal: number;
  discount: number;
  tax: number;
  tip: number;
  shipping: number;
  grand_total: number;
}

export interface ItemChangesPreviewLine {
  key: string;
  order_item_id: number | null;
  product_name: string;
  variant_label: string | null;
  action: 'add' | 'increase' | 'decrease' | 'remove' | 'reprice';
  quantity_before: number | null;
  quantity_after: number;
  kitchen_status: ItemChangeKitchenStatus;
  kitchen_ticket_number: number | null;
  kitchen_effect: ItemChangeKitchenEffect;
  stock_effect: ItemChangeStockEffect;
  requires_cancellation_type: boolean;
  blocked: boolean;
  blocked_reason: string | null;
  messages: string[];
}

/**
 * Resultado de cocina de `apply`. `stock_warnings` comparte shape con la
 * respuesta de POST /store/kitchen-fire (`InsufficientStockItem[]`).
 */
export interface ItemChangesKitchenResult {
  kitchen_ticket_ids: number[];
  stock_warnings: InsufficientStockItem[];
}

export interface ItemChangesPreview {
  order_id: number;
  version: string;
  can_apply: boolean;
  lines: ItemChangesPreviewLine[];
  totals: { before: ItemChangesTotals; after: ItemChangesTotals };
  warnings: string[];
}

/** Operaciones resueltas que `apply` ejecuta (derivadas del mismo plan). */
interface PlannedRemove {
  order_item_id: number;
  cancellation_type?: 'after_fire_waste' | 'after_fire_reused';
}
interface PlannedUpdate {
  line: any;
  new_quantity: number;
  new_total_price: number;
  new_discount: number | null;
  new_stock_units: number | null;
  new_tax_rows: Array<{ id: number; tax_amount: number }>;
  /** `tax_amount_item` re-tasado (null = la línea no lo usa; no se escribe). */
  new_tax_amount_item: number | null;
  /** Impuesto TOTAL resultante de la línea (filas, o `tax_amount_item` × unidades). */
  new_tax_total: number;
  reserve_delta_units: number; // >0 reservar, <0 liberar, 0 nada
}
/** Línea NO tocada por el usuario cuyo descuento/impuesto cambia al re-cotizar. */
interface PlannedReprice {
  line: any;
  new_discount: number;
  new_tax_rows: Array<{ id: number; tax_amount: number }>;
  new_tax_amount_item: number | null;
}
interface PlannedAdd {
  index: number;
  product: any;
  variant: any | null;
  quantity: number;
  notes: string | null;
  resolution: ReturnType<typeof resolveCatalogLine>;
  rows: FullTaxRow[];
  fire: boolean;
  reserve: boolean;
  /** Descuento de BASE que recibe la línea nueva (solo al redistribuir). */
  discount: number;
  /** Plan fiscal (impuesto ya sobre base descontada) con el que se persiste. */
  planned: PlannedOrderLine;
}

interface ItemChangesPlan {
  preview: ItemChangesPreview;
  order: any;
  removes: PlannedRemove[];
  updates: PlannedUpdate[];
  reprices: PlannedReprice[];
  adds: PlannedAdd[];
  discountOverride?: number;
  /**
   * Snapshot re-cotizado de `order_promotions` (solo si hubo redistribución o
   * pérdida de cupón): `apply` reconcilia las filas con él.
   */
  promotionSync: Array<{ promotion_id: number; discount_amount: number }> | null;
  /** `coupon_uses.discount_applied` de ESTA orden cuando el descuento del cupón cambió. */
  couponUseSync: { id: number; discount_applied: number } | null;
  /** Bloqueo a nivel plan (p.ej. falló la re-cotización de promociones). */
  planBlock: VendixHttpException | null;
  blockedCodes: Map<string, string>; // line key -> error code
  allowOversell: boolean;
}

const EDITABLE_ORDER_STATES = ['draft', 'created'];

@Injectable()
export class OrderItemChangesService {
  private readonly logger = new Logger(OrderItemChangesService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly orderFlowService: OrderFlowService,
    private readonly ordersService: OrdersService,
    private readonly kitchenFireService: KitchenFireService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly stockValidator: StockValidatorService,
    private readonly sellableStockAllocator: SellableStockAllocator,
    private readonly orderSse: OrderSseService,
    private readonly auditService: AuditService,
    private readonly promotionEngine: PromotionEngineService,
    private readonly couponsService: CouponsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Calcula las consecuencias del change-set sin escribir nada. */
  async preview(
    orderId: number,
    dto: OrderItemChangesDto,
  ): Promise<ItemChangesPreview> {
    const plan = await this.buildPlan(this.prisma, orderId, dto);
    return plan.preview;
  }

  /** Aplica el change-set en UNA transacción; efectos externos post-commit. */
  async apply(orderId: number, dto: OrderItemChangesDto) {
    this.validateChangeSet(dto);
    const { storeId, userId } = this.requireContext();
    const removes = dto.remove ?? [];
    if (!dto.expected_version) {
      throw this.invalid('expected_version es obligatorio para aplicar los cambios');
    }
    const reason = (dto.reason ?? '').trim();
    if (removes.length > 0 && reason.length < 3) {
      throw this.invalid(
        'Debes indicar un motivo (mínimo 3 caracteres) para quitar productos',
      );
    }

    const txResult = await this.prisma.$transaction(
      async (tx) => {
        // Bloquea la orden (y aplica unsplit/estado/pagos) ANTES de releer.
        try {
          await this.orderFlowService.assertOrderItemsCancellableInTx(
            tx,
            orderId,
            storeId,
          );
        } catch (err) {
          if (
            err instanceof VendixHttpException &&
            err.errorCode === ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE.code
          ) {
            const d = (err.getResponse() as any)?.details ?? {};
            throw new VendixHttpException(
              ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE,
              this.editBlockMessage(d.reason, d.state ?? ''),
            );
          }
          throw err;
        }
        const plan = await this.buildPlan(tx, orderId, dto, {
          tx,
          expectedVersion: dto.expected_version,
        });
        if (!plan.preview.can_apply) {
          throw this.firstBlock(plan);
        }
        const order = { ...plan.order, id: orderId };

        const reserveWarnings: InsufficientStockItem[] = [];
        // --- Quitar: soft-cancel reutilizando el núcleo de OrderFlow -------
        const cancelEffects: OrderItemCancelEffects[] = [];
        for (const r of plan.removes) {
          cancelEffects.push(
            await this.orderFlowService.cancelOrderItemInTx(tx, {
              order,
              orderItemId: r.order_item_id,
              reason,
              cancellationType: r.cancellation_type,
              skipTotalsRecalc: true,
            }),
          );
        }

        // --- Cambiar cantidad: update in place (mismo id) -------------------
        for (const u of plan.updates) {
          await tx.order_items.update({
            where: { id: u.line.id },
            data: {
              quantity: u.new_quantity,
              total_price: new Prisma.Decimal(u.new_total_price),
              ...(u.new_discount != null
                ? { discount_amount: new Prisma.Decimal(u.new_discount) }
                : {}),
              ...(u.new_tax_amount_item != null
                ? { tax_amount_item: new Prisma.Decimal(u.new_tax_amount_item) }
                : {}),
              ...(u.new_stock_units != null
                ? { stock_units_consumed: u.new_stock_units }
                : {}),
              updated_at: new Date(),
            },
          });
          for (const t of u.new_tax_rows) {
            await tx.order_item_taxes.update({
              where: { id: t.id },
              data: { tax_amount: new Prisma.Decimal(t.tax_amount) },
            });
          }
          if (u.reserve_delta_units < 0) {
            await this.stockLevelManager.releaseReservationQuantity(
              'order',
              orderId,
              u.line.product_id,
              u.line.product_variant_id ?? undefined,
              Math.abs(u.reserve_delta_units),
              'cancelled',
              tx,
            );
          }
        }

        // --- Re-cotización: líneas NO tocadas cuyo descuento cambia ----------
        // Update en sitio (mismo id): SOLO discount_amount y el monto de sus
        // order_item_taxes. Nada más de la línea se escribe.
        for (const r of plan.reprices) {
          await tx.order_items.update({
            where: { id: r.line.id },
            data: {
              discount_amount: new Prisma.Decimal(r.new_discount),
              updated_at: new Date(),
              ...(r.new_tax_amount_item != null
                ? { tax_amount_item: new Prisma.Decimal(r.new_tax_amount_item) }
                : {}),
            },
          });
          for (const t of r.new_tax_rows) {
            await tx.order_item_taxes.update({
              where: { id: t.id },
              data: { tax_amount: new Prisma.Decimal(t.tax_amount) },
            });
          }
        }
        // `coupon_uses.discount_applied` de ESTA orden sigue al nuevo descuento
        // del cupón. NO se ajusta `promotions.usage_count` (el editor tampoco):
        // la promoción sigue contada una vez por esta orden.
        if (plan.couponUseSync) {
          await tx.coupon_uses.update({
            where: { id: plan.couponUseSync.id },
            data: { discount_applied: new Prisma.Decimal(plan.couponUseSync.discount_applied) },
          });
        }
        // order_promotions: se reconcilia con la re-cotización EN SITIO por
        // promotion_id. Una promoción que deja de aplicar NO se borra: su fila
        // queda en 0 para seguir en el alcance (`order_scope`) y poder volver a
        // aplicar en una edición posterior (p.ej. si se re-agrega el producto).
        if (plan.promotionSync) {
          const existing: Array<{ id: number; promotion_id: number }> =
            plan.order.order_promotions ?? [];
          const wanted = new Map(
            plan.promotionSync.map((p) => [p.promotion_id, p.discount_amount]),
          );
          const kept = new Set<number>();
          for (const e of existing) {
            kept.add(e.promotion_id);
            await tx.order_promotions.updateMany({
              where: { order_id: orderId, promotion_id: e.promotion_id },
              data: {
                discount_amount: new Prisma.Decimal(wanted.get(e.promotion_id) ?? 0),
              },
            });
          }
          const created = plan.promotionSync.filter((p) => !kept.has(p.promotion_id));
          if (created.length > 0) {
            await tx.order_promotions.createMany({
              data: created.map((p) => ({
                order_id: orderId,
                promotion_id: p.promotion_id,
                customer_id: plan.order.customer_id ?? null,
                discount_amount: new Prisma.Decimal(p.discount_amount),
              })),
            });
          }
        }

        // --- Stock: validar + reservar aumentos y líneas nuevas -------------
        const demands: StockDemandLine[] = [
          ...plan.updates
            .filter((u) => u.reserve_delta_units > 0)
            .map((u) => ({
              product_id: u.line.product_id,
              product_variant_id: u.line.product_variant_id,
              quantity: u.reserve_delta_units,
              product_name: u.line.product_name,
            })),
          ...plan.adds
            .filter((a) => a.reserve)
            .map((a) => ({
              product_id: a.product.id,
              product_variant_id: a.variant?.id ?? undefined,
              quantity: a.quantity,
              product_name: a.product.name,
            })),
        ];
        await this.stockValidator.assertLinesAvailable(demands, {
          tx,
          allowOversell: plan.allowOversell,
        });
        for (const u of plan.updates) {
          if (u.reserve_delta_units > 0) {
            await this.reserveUnits(
              {
                product_id: u.line.product_id,
                product_variant_id: u.line.product_variant_id ?? null,
                product_name: u.line.product_name,
              },
              u.reserve_delta_units,
              orderId,
              storeId,
              userId,
              tx,
              plan.allowOversell,
              reserveWarnings,
            );
          }
        }

        // --- Agregar: líneas nuevas con precio/tax de catálogo -------------
        const newItemIds: number[] = [];
        const fireIds: number[] = [];
        for (const a of plan.adds) {
          const { resolution: res } = a;
          const created = await tx.order_items.create({
            data: {
              order_id: orderId,
              product_id: a.product.id,
              product_variant_id: a.variant?.id ?? null,
              product_name: a.product.name,
              variant_sku: a.variant?.sku ?? null,
              variant_attributes: a.variant?.attributes
                ? JSON.stringify(a.variant.attributes)
                : null,
              quantity: a.quantity,
              unit_price: new Prisma.Decimal(res.unitBase),
              total_price: new Prisma.Decimal(res.totalPrice),
              tax_rate: new Prisma.Decimal(res.taxRate),
              tax_amount_item: new Prisma.Decimal(
                a.planned?.tax_amount_item ?? res.taxAmountItem,
              ),
              final_unit_price: new Prisma.Decimal(res.finalUnitPrice),
              catalog_unit_price: new Prisma.Decimal(res.catalogUnitPrice),
              catalog_final_price: new Prisma.Decimal(res.finalUnitPrice),
              price_unit_quantity:
                res.priceUnitQuantity > 1 ? res.priceUnitQuantity : null,
              item_type: a.product.product_type ?? 'physical',
              cost_price: null,
              is_price_overridden: false,
              inventory_consumed_at_fire: false,
              skip_kds: false,
              notes: a.notes,
              updated_at: new Date(),
              ...(a.discount > 0
                ? { discount_amount: new Prisma.Decimal(a.discount) }
                : {}),
              ...(a.planned.taxes.length > 0
                ? {
                    order_item_taxes: this.ordersService.toOrderItemTaxesCreate(
                      a.planned,
                    ),
                  }
                : {}),
            },
            select: { id: true },
          });
          newItemIds.push(created.id);
          if (a.fire) fireIds.push(created.id);
          if (a.reserve) {
            await this.reserveUnits(
              {
                product_id: a.product.id,
                product_variant_id: a.variant?.id ?? null,
                product_name: a.product.name,
              },
              a.quantity,
              orderId,
              storeId,
              userId,
              tx,
              plan.allowOversell,
              reserveWarnings,
            );
          }
        }

        // --- Cocina: fire en la MISMA tx (patrón payments.service) ----------
        let fireResult: Awaited<
          ReturnType<KitchenFireService['fireOrderItemsInTx']>
        > | null = null;
        if (fireIds.length > 0) {
          const ctx = await this.kitchenFireService.prepareFireContext(
            orderId,
            fireIds,
            tx,
          );
          if (ctx && ctx.firedItemIds.length > 0) {
            fireResult = await this.kitchenFireService.fireOrderItemsInTx(
              tx,
              storeId,
              ctx,
            );
          }
        }

        // --- Totales: UN recálculo desde las líneas activas -----------------
        const freshOrder = await this.orderFlowService.getOrder(orderId, tx);
        await this.orderFlowService.recalcOrderTotalsFromActiveLinesInTx(
          tx,
          freshOrder,
          orderId,
          plan.discountOverride != null
            ? { discountOverride: plan.discountOverride }
            : undefined,
        );

        return { plan, cancelEffects, fireResult, newItemIds, reserveWarnings };
      },
      { timeout: 20_000, maxWait: 5_000 },
    );

    const { plan, cancelEffects, fireResult, newItemIds, reserveWarnings } =
      txResult;

    // --- Post-commit: nada de esto revierte el cambio ya persistido ---------
    for (const effects of cancelEffects) {
      try {
        await this.orderFlowService.runOrderItemCancelEffectsAfterCommit(
          orderId,
          effects.orderItemId,
          storeId,
          effects,
        );
      } catch (err) {
        this.logger.error(
          `Post-commit cancel effects failed order=${orderId} item=${effects.orderItemId}: ${(err as Error).message}`,
        );
      }
    }
    let kitchenTicketIds: number[] = fireResult?.ticketIds ?? [];
    if (fireResult) {
      try {
        const emitted = await this.kitchenFireService.emitKitchenFiredAfterCommit(
          storeId,
          undefined,
          fireResult,
          orderId,
        );
        if (emitted?.kitchen_ticket_ids?.length) {
          kitchenTicketIds = emitted.kitchen_ticket_ids;
        }
      } catch (err) {
        this.logger.error(
          `emitKitchenFiredAfterCommit failed order=${orderId}: ${(err as Error).message}`,
        );
      }
    }
    const stockWarnings: InsufficientStockItem[] = [
      ...(fireResult?.stockWarnings ?? []),
      ...reserveWarnings,
    ];
    this.orderSse.pushOrderEvent(storeId, orderId, 'order.items.updated', {
      order_number: plan.order.order_number,
      item_count:
        plan.removes.length + plan.updates.length + plan.adds.length,
      is_draft: plan.order.state === 'draft',
    });
    try {
      if (userId) {
        await this.auditService.logCustom(
          userId,
          'order.items.changed',
          AuditResource.ORDERS,
          {
            added_item_ids: newItemIds,
            updated_item_ids: plan.updates.map((u) => u.line.id),
            removed_item_ids: plan.removes.map((r) => r.order_item_id),
            reason: reason || undefined,
          },
          orderId,
        );
      }
    } catch (err) {
      this.logger.warn(`order.items.changed audit failed: ${(err as Error).message}`);
    }

    // Lo ya persistido no se revierte: si releer la orden falla, el frontend
    // recibe `order: null` + `reload_required` y la vuelve a pedir.
    let order: any = null;
    let reloadRequired = false;
    try {
      order = await this.ordersService.findOne(orderId);
    } catch (err) {
      reloadRequired = true;
      this.logger.error(
        `findOne post-commit failed order=${orderId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
    // `kitchen`: lo que el frontend necesita para imprimir la comanda
    // (`printAfterFire(kitchen_ticket_ids)`) y mostrar avisos de stock.
    // `stock_warnings` usa el MISMO shape que POST /store/kitchen-fire
    // (`InsufficientStockItem[]`): insumos del fire con sobre-uso permitido
    // MÁS la sobreventa absorbida al reservar unidades (kind:'product').
    const kitchen: ItemChangesKitchenResult = {
      kitchen_ticket_ids: kitchenTicketIds,
      stock_warnings: stockWarnings,
    };
    return {
      order,
      summary: plan.preview,
      kitchen,
      ...(reloadRequired ? { reload_required: true as const } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Plan (compartido por preview y apply)
  // ---------------------------------------------------------------------------

  async buildPlan(
    client: Client,
    orderId: number,
    dto: OrderItemChangesDto,
    opts: { tx?: Prisma.TransactionClient; expectedVersion?: string } = {},
  ): Promise<ItemChangesPlan> {
    this.validateChangeSet(dto);
    const { storeId } = this.requireContext();
    const db = client as any;

    const order = await db.orders.findFirst({
      where: { id: orderId, store_id: storeId },
      include: {
        stores: {
          select: {
            id: true,
            name: true,
            store_code: true,
            organization_id: true,
            industries: true,
          },
        },
        payments: {
          include: {
            store_payment_method: {
              select: {
                system_payment_method: {
                  select: { type: true, processing_mode: true },
                },
              },
            },
          },
        },
        table_sessions: { select: { id: true }, take: 1 },
        order_promotions: { select: { id: true, promotion_id: true, discount_amount: true } },
      },
    });
    if (!order) throw new VendixHttpException(ErrorCodes.ORD_FIND_001);

    const updatedAtIso = order.updated_at
      ? new Date(order.updated_at).toISOString()
      : '';
    // La version completa es `${updated_at ISO}|${hash del resumen}`; acá solo
    // se compara la parte de `updated_at` (la orden cambió); el hash, al final.
    if (
      opts.expectedVersion !== undefined &&
      opts.expectedVersion.split('|')[0] !== updatedAtIso
    ) {
      throw new VendixHttpException(
        ErrorCodes.ORD_EDIT_INVALID_STATE_001,
        'La orden cambió mientras editabas. Revisa los cambios.',
      );
    }
    if (!EDITABLE_ORDER_STATES.includes(order.state)) {
      throw new VendixHttpException(ErrorCodes.ORD_EDIT_NOT_ALLOWED_001);
    }
    assertNoActiveFinancialSplit(order);
    await this.ordersService.assertTableOrderEditable(orderId, storeId);

    // Guarda de orden (pagada / terminal): la misma que aplica `apply`.
    const cancelBlock = this.orderFlowService.getOrderItemCancelBlock(order);
    const orderBlock = cancelBlock
      ? {
          code: cancelBlock.code,
          message: this.editBlockMessage(cancelBlock.reason, order.state),
        }
      : null;

    const lineRows: any[] = await db.order_items.findMany({
      where: { order_id: orderId },
      orderBy: { id: 'asc' },
      include: {
        products: {
          select: { id: true, name: true, product_type: true, track_inventory: true },
        },
        product_variants: {
          select: { id: true, name: true, sku: true, track_inventory_override: true },
        },
        order_item_taxes: true,
        kitchen_ticket_items: {
          orderBy: { id: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            kitchen_ticket_id: true,
            kitchen_ticket: { select: { id: true, status: true, daily_number: true } },
          },
        },
      },
    });
    const activeLines = lineRows.filter((l) => l.cancelled_at == null);
    const lineById = new Map<number, any>(activeLines.map((l) => [l.id, l]));

    // "La orden reserva stock": estado created, mesa abierta, o al menos una
    // reserva activa referenciando esta orden (un draft sin mesa que ya
    // reservó debe liberar al bajar cantidad).
    let reservesStock =
      order.state === 'created' || (order.table_sessions?.length ?? 0) > 0;
    if (!reservesStock) {
      const activeReservations = await db.stock_reservations.count({
        where: {
          reserved_for_type: 'order',
          reserved_for_id: orderId,
          status: 'active',
        },
      });
      reservesStock = Number(activeReservations) > 0;
    }
    const restaurant = storeIsRestaurant(order.stores?.industries);

    const lines: ItemChangesPreviewLine[] = [];
    const blockedCodes = new Map<string, string>();
    const removes: PlannedRemove[] = [];
    const updates: PlannedUpdate[] = [];
    const adds: PlannedAdd[] = [];
    const awaitingChoice = new Set<string>();

    const markBlocked = (
      line: ItemChangesPreviewLine,
      reason: string,
      code: string = ErrorCodes.ORD_ITEM_CHANGES_INVALID_001.code,
    ) => {
      line.blocked = true;
      line.blocked_reason = reason;
      line.messages.push(reason);
      blockedCodes.set(line.key, code);
    };

    const liveKti = (l: any) => {
      const k = l.kitchen_ticket_items?.[0] ?? null;
      return k && k.status !== 'cancelled' ? k : null;
    };
    const kitchenStatusOf = (l: any): ItemChangeKitchenStatus => {
      const k = liveKti(l);
      if (k && ['pending', 'in_preparation', 'ready', 'delivered'].includes(k.status)) {
        return k.status;
      }
      return l.delivered_at != null ? 'delivered' : 'none';
    };
    const isTracked = (l: any) =>
      l.product_id != null &&
      l.products &&
      l.products.product_type !== 'prepared' &&
      l.products.product_type !== 'service' &&
      this.stockValidator.resolveEffectiveTracking(
        l.products,
        l.product_variants ?? undefined,
      );
    const variantLabelOf = (l: any): string | null =>
      l.product_variants?.name ?? l.variant_sku ?? null;

    // ---- remove --------------------------------------------------------------
    for (const r of dto.remove ?? []) {
      const l = lineById.get(r.order_item_id);
      if (!l) {
        throw this.invalid(
          `La línea #${r.order_item_id} no existe en la orden o ya está cancelada`,
        );
      }
      const c = await this.orderFlowService.classifyOrderItemCancellation(
        client as any,
        { ...order, id: orderId },
        r.order_item_id,
        r.cancellation_type,
      );
      const kti = liveKti(l);
      const ticketNumber: number | null = kti?.kitchen_ticket?.daily_number ?? null;
      const line: ItemChangesPreviewLine = {
        key: `existing:${l.id}`,
        order_item_id: l.id,
        product_name: l.product_name,
        variant_label: variantLabelOf(l),
        action: 'remove',
        quantity_before: l.quantity,
        quantity_after: 0,
        kitchen_status: kitchenStatusOf(l),
        kitchen_ticket_number: ticketNumber,
        kitchen_effect: kti ? 'cancel_ticket_item' : 'none',
        stock_effect: 'none',
        requires_cancellation_type: c.requiresCancellationType,
        blocked: false,
        blocked_reason: null,
        messages: [],
      };
      if (kti) {
        line.messages.push(
          ticketNumber != null
            ? `Se cancelará la comanda #${ticketNumber} en cocina (queda en el histórico)`
            : 'Se cancelará la comanda en cocina (queda en el histórico)',
        );
      }
      if (c.blocked && c.blocked.phase === 'cancellation_type' && !r.cancellation_type) {
        awaitingChoice.add(line.key);
        line.messages.push(
          'Elige si los insumos se reutilizan o se registran como merma',
        );
      } else if (c.blocked) {
        markBlocked(line, c.blocked.message, c.blocked.code.code);
      } else {
        if (c.resolvedType === 'after_fire_reused') {
          line.stock_effect = 'ingredients_reused';
          line.messages.push('Los insumos se reutilizan');
        } else if (c.resolvedType === 'after_fire_waste' && c.preparedFired) {
          line.stock_effect = 'ingredients_wasted';
          line.messages.push('Los insumos se registran como merma');
        } else if (!c.wasFired && isTracked(l) && reservesStock) {
          line.stock_effect = 'release';
          line.messages.push('Se liberará la reserva de stock');
        }
      }
      if (orderBlock && !line.blocked) {
        markBlocked(line, orderBlock.message, orderBlock.code.code);
      }
      removes.push({
        order_item_id: l.id,
        cancellation_type: r.cancellation_type,
      });
      lines.push(line);
    }

    // ---- update --------------------------------------------------------------
    for (const u of dto.update ?? []) {
      const l = lineById.get(u.order_item_id);
      if (!l) {
        throw this.invalid(
          `La línea #${u.order_item_id} no existe en la orden o ya está cancelada`,
        );
      }
      if (u.quantity === l.quantity) continue; // sin cambio real
      const increase = u.quantity > l.quantity;
      const kti = liveKti(l);
      const fired =
        l.inventory_consumed_at_fire === true ||
        (kti != null && kti.status !== 'delivered');
      const line: ItemChangesPreviewLine = {
        key: `existing:${l.id}`,
        order_item_id: l.id,
        product_name: l.product_name,
        variant_label: variantLabelOf(l),
        action: increase ? 'increase' : 'decrease',
        quantity_before: l.quantity,
        quantity_after: u.quantity,
        kitchen_status: kitchenStatusOf(l),
        kitchen_ticket_number: kti?.kitchen_ticket?.daily_number ?? null,
        kitchen_effect: 'none',
        stock_effect: 'none',
        requires_cancellation_type: false,
        blocked: false,
        blocked_reason: null,
        messages: [],
      };
      lines.push(line);
      const ratio = u.quantity / l.quantity;
      const tracked = isTracked(l) && reservesStock;
      const oldUnits = Number(l.stock_units_consumed ?? 0) || l.quantity;
      const newStockUnits =
        l.stock_units_consumed != null
          ? Math.max(1, Math.round(Number(l.stock_units_consumed) * ratio))
          : null;
      const newUnits = newStockUnits ?? u.quantity;
      const delta = tracked ? newUnits - oldUnits : 0;
      if (l.delivered_at != null) {
        markBlocked(line, 'Ya se entregó; no se puede cambiar la cantidad');
      } else if (l.weight != null && Number(l.weight) > 0) {
        markBlocked(
          line,
          'Es un producto por peso: quítalo y agrégalo de nuevo con el peso correcto',
        );
      } else if (fired && !increase) {
        markBlocked(
          line,
          'Ya está en cocina: no se puede reducir; quítalo completo y se cancelará su comanda',
        );
      } else if (fired && increase) {
        markBlocked(
          line,
          'Ya está en cocina: agrega las unidades extra como un plato nuevo',
        );
      } else if (orderBlock) {
        markBlocked(line, orderBlock.message, orderBlock.code.code);
      }
      if (delta !== 0) {
        line.stock_effect = delta > 0 ? 'reserve' : 'release';
        line.messages.push(
          delta > 0
            ? 'Se reservarán las unidades adicionales de stock'
            : 'Se liberará la reserva de stock sobrante',
        );
      }
      // Total = unit_price × unidades de la línea (nunca `total × ratio`:
      // 100 -> 33,33 -> 99,99 deriva en cada ida y vuelta).
      const unitPrice = Number(l.unit_price);
      const oldTotal = Number(l.total_price);
      const newBase =
        unitPrice > 0
          ? roundMoney2(
              unitPrice *
                resolveLineUnits({
                  quantity: u.quantity,
                  weight: l.weight,
                  price_unit_quantity: l.price_unit_quantity,
                }),
            )
          : roundMoney2(oldTotal * ratio);
      // El descuento de la línea es un MONTO ABSOLUTO (un cupón fijo de $10
      // sigue siendo $10), con clamp a la nueva base.
      const newDiscount =
        l.discount_amount != null
          ? roundMoney2(Math.min(Number(l.discount_amount), newBase))
          : null;
      // Impuesto sobre la base descontada, misma convención del kernel del
      // editor (`applyGrossDiscountRetax`): `round2(base_neta × tarifa)`.
      const netBase = newBase - (newDiscount ?? 0);
      const newTaxRows = (l.order_item_taxes ?? []).map((t: any) => ({
        id: t.id,
        tax_amount: roundMoney2(netBase * this.rateOfTaxRow(t, oldTotal)),
      }));
      // Línea sin filas (custom del POS): su impuesto es `tax_amount_item` ×
      // unidades; se escala a la nueva base neta con la tasa implícita.
      // La tasa implícita sale de `tax_rate` o, sin ella, de impuesto /
      // (base − descuento): ese impuesto YA va sobre la base descontada, y
      // dividirlo por la base bruta subestimaría la tasa (doble descuento).
      const rowlessTaxTotal = roundMoney2(
        netBase * this.impliedRateOfRowlessLine(l),
      );
      const rawTaxTotal =
        newTaxRows.length > 0
          ? roundMoney2(newTaxRows.reduce((sum: number, t: any) => sum + t.tax_amount, 0))
          : rowlessTaxTotal;
      const newTaxItem = this.retaxedTaxAmountItem(l, newBase, rawTaxTotal);
      // Lo que el preview suma es lo que el recalc leerá de lo persistido.
      const newTaxTotal = this.persistedLineTax(
        l,
        u.quantity,
        newTaxItem,
        newTaxRows.length,
        rawTaxTotal,
      );
      updates.push({
        line: l,
        new_quantity: u.quantity,
        new_total_price: newBase,
        new_discount: newDiscount,
        new_stock_units: newStockUnits,
        new_tax_rows: newTaxRows,
        // Misma convención del kernel del editor: impuesto de línea / líneas.
        new_tax_amount_item: newTaxItem,
        new_tax_total: newTaxTotal,
        reserve_delta_units: delta,
      });
    }

    // ---- add -----------------------------------------------------------------
    const addDtos = dto.add ?? [];
    if (addDtos.length > 0) {
      await assertVariantRequiredForPrepared(db, addDtos);
      const productIds = [...new Set(addDtos.map((a) => a.product_id))];
      const products: any[] = await db.products.findMany({
        where: { id: { in: productIds }, store_id: storeId },
        select: {
          id: true,
          name: true,
          base_price: true,
          is_on_sale: true,
          sale_price: true,
          is_sellable: true,
          state: true,
          product_type: true,
          track_inventory: true,
          price_unit_quantity: true,
          product_variants: { select: { id: true }, take: 1 },
        },
      });
      const productById = new Map<number, any>(products.map((p) => [p.id, p]));
      const variantIds = [
        ...new Set(
          addDtos
            .map((a) => a.product_variant_id)
            .filter((v): v is number => typeof v === 'number'),
        ),
      ];
      const variants: any[] =
        variantIds.length > 0
          ? await db.product_variants.findMany({
              where: { id: { in: variantIds } },
              select: {
                id: true,
                product_id: true,
                sku: true,
                name: true,
                attributes: true,
                price_override: true,
                is_on_sale: true,
                sale_price: true,
                track_inventory_override: true,
              },
            })
          : [];
      const variantById = new Map<number, any>(variants.map((v) => [v.id, v]));
      const taxRowsByProduct = await resolveFullTaxRowsByProductId(
        db,
        productIds,
      );

      for (const [index, a] of addDtos.entries()) {
        const p = productById.get(a.product_id);
        if (!p) {
          throw this.invalid(
            `Producto #${a.product_id} no existe o no pertenece a la tienda`,
          );
        }
        if (!p.is_sellable) {
          throw this.invalid(`Producto "${p.name}" no es vendible`);
        }
        if (p.state !== 'active') {
          throw this.invalid(`Producto "${p.name}" no está activo`);
        }
        if ((p.product_variants?.length ?? 0) > 0 && a.product_variant_id == null) {
          throw new VendixHttpException(
            ErrorCodes.PRODUCT_VARIANT_REQUIRED,
            `El producto "${p.name}" tiene variantes: selecciona una.`,
          );
        }
        let variant: any = null;
        if (a.product_variant_id != null) {
          variant = variantById.get(a.product_variant_id) ?? null;
          if (!variant || variant.product_id !== a.product_id) {
            throw new VendixHttpException(
              ErrorCodes.PRODUCT_VARIANT_MISMATCH,
              `La variante #${a.product_variant_id} no pertenece al producto #${a.product_id}`,
            );
          }
        }
        const rows = taxRowsByProduct.get(a.product_id) ?? [];
        const resolution = resolveCatalogLine({
          catalogUnitPrice: resolveCatalogUnitPrice(p, variant),
          quantity: a.quantity,
          priceUnitQuantityRaw: p.price_unit_quantity,
          rows,
        });
        const fire = restaurant && p.product_type === 'prepared';
        const tracked =
          p.product_type !== 'prepared' &&
          p.product_type !== 'service' &&
          this.stockValidator.resolveEffectiveTracking(p, variant ?? undefined);
        const reserve = !fire && tracked && reservesStock;
        const line: ItemChangesPreviewLine = {
          key: `add:${index}`,
          order_item_id: null,
          product_name: p.name,
          variant_label: variant?.name ?? variant?.sku ?? null,
          action: 'add',
          quantity_before: null,
          quantity_after: a.quantity,
          kitchen_status: 'none',
          kitchen_ticket_number: null,
          kitchen_effect: fire ? 'fire' : 'none',
          stock_effect: fire ? 'ingredients_consumed' : reserve ? 'reserve' : 'none',
          requires_cancellation_type: false,
          blocked: false,
          blocked_reason: null,
          messages: [],
        };
        if (fire) {
          line.messages.push('Irá a cocina al guardar');
          line.messages.push('Se consumirán los insumos de la receta');
        } else if (reserve) {
          line.messages.push('Se reservará stock');
        }
        if (orderBlock) markBlocked(line, orderBlock.message, orderBlock.code.code);
        // Compuerta F4 de IVA (misma que `PUT :id/items`): un comercio no
        // responsable de IVA no puede vender productos con IVA.
        try {
          await this.ordersService.assertSaleVatAllowed([
            { product_id: p.id, tax_amount_item: resolution.taxAmountItem },
          ]);
        } catch (err) {
          if (!(err instanceof VendixHttpException)) throw err;
          markBlocked(line, err.message, err.errorCode);
        }
        lines.push(line);
        adds.push({
          index,
          product: p,
          variant,
          quantity: a.quantity,
          notes: a.notes?.trim() || null,
          resolution,
          rows,
          fire,
          reserve,
          discount: 0,
          planned: this.plannedLineOfAdd(resolution),
        });
      }
    }

    // Updates sin cambio real se descartan: si no queda NADA, no hay cambios.
    if (removes.length + updates.length + adds.length === 0) {
      throw this.invalid('No hay cambios para aplicar');
    }

    const warnings: string[] = [];

    // ---- insumos del BOM de platos nuevos que irán a cocina (sin escribir) ---
    const fireAdds = adds.filter((a) => a.fire);
    if (fireAdds.length > 0) {
      const { allowIngredientOveruse, shortages } =
        await this.kitchenFireService.previewIngredientShortfall(
          fireAdds.map((a) => ({
            product_id: a.product.id,
            product_variant_id: a.variant?.id ?? null,
            quantity: a.quantity,
            product_name: a.product.name,
          })),
          { tx: opts.tx },
        );
      // Insumos que devuelven los removes con `ingredients_reused`: se leen de
      // los consumos (`quantity_change < 0`) de cada línea quitada y se acreditan
      // a la disponibilidad (un intercambio quitar+agregar el mismo plato no se
      // bloquea de más).
      const reusedIds = removes
        .map((r) => r.order_item_id)
        .filter(
          (id) =>
            lines.find((x) => x.key === `existing:${id}`)?.stock_effect ===
            'ingredients_reused',
        );
      const returned = new Map<string, number>();
      if (reusedIds.length > 0) {
        const consumed: Array<{
          product_id: number;
          product_variant_id: number | null;
          quantity_change: number;
        }> =
          (await db.inventory_transactions.findMany({
            where: { order_item_id: { in: reusedIds }, quantity_change: { lt: 0 } },
            select: {
              product_id: true,
              product_variant_id: true,
              quantity_change: true,
            },
          })) ?? [];
        for (const c of consumed) {
          const k = `${c.product_id}-${c.product_variant_id ?? 'null'}`;
          returned.set(k, (returned.get(k) ?? 0) + Math.abs(c.quantity_change));
        }
      }
      const effectiveShortages = (shortages ?? [])
        .map((sh) => ({
          ...sh,
          available:
            sh.available +
            (returned.get(`${sh.product_id}-${sh.product_variant_id ?? 'null'}`) ?? 0),
        }))
        .filter((sh) => sh.requested > sh.available);
      for (const sh of effectiveShortages) {
        const detail = `${sh.product_name} (se necesitan ${sh.requested}, hay ${sh.available})`;
        const dishNames = new Set(sh.used_by ?? []);
        const affected = fireAdds.filter(
          (a) => dishNames.size === 0 || dishNames.has(a.product.name),
        );
        for (const a of affected) {
          const line = lines.find((l) => l.key === `add:${a.index}`)!;
          const msg = `Faltan insumos para ${a.product.name}: ${detail}`;
          if (allowIngredientOveruse) {
            line.messages.push(`${msg}. La tienda permite sobre-uso de insumos`);
            warnings.push(msg);
          } else {
            markBlocked(
              line,
              msg,
              ErrorCodes.INV_STOCK_INSUFFICIENT_LINES.code,
            );
          }
        }
      }
    }

    // ---- stock disponible (no lanza; marca la línea) ---------------------------
    // Demanda NETA: las unidades que el mismo change-set libera (remove y
    // decrease del mismo producto/variante) se acreditan contra lo que
    // aumenta o se agrega. `apply` ya libera antes de validar, así que esto
    // lo hace coherente con él.
    const inventoryPolicy = await this.stockValidator.resolveInventoryPolicy(
      storeId,
      opts.tx,
    );
    const allowOversell = inventoryPolicy.allowOversell === true;
    const stockKey = (p: number, v: number | null | undefined) =>
      `${p}-${v ?? 'null'}`;
    const released = new Map<string, number>();
    const credit = (p: number, v: number | null | undefined, n: number) =>
      released.set(stockKey(p, v), (released.get(stockKey(p, v)) ?? 0) + n);
    if (reservesStock) {
      for (const r of removes) {
        const l = lineById.get(r.order_item_id);
        const rl = lines.find((x) => x.key === `existing:${r.order_item_id}`);
        if (l && rl?.stock_effect === 'release') {
          credit(
            l.product_id,
            l.product_variant_id,
            Number(l.stock_units_consumed ?? 0) || l.quantity,
          );
        }
      }
    }
    for (const u of updates) {
      if (u.reserve_delta_units < 0) {
        credit(
          u.line.product_id,
          u.line.product_variant_id,
          Math.abs(u.reserve_delta_units),
        );
      }
    }
    const demandBySku = new Map<
      string,
      { demand: StockDemandLine; keys: string[] }
    >();
    const addDemand = (
      lineKey: string,
      productId: number,
      variantId: number | null | undefined,
      quantity: number,
      name: string,
    ) => {
      const k = stockKey(productId, variantId);
      const cur = demandBySku.get(k);
      if (cur) {
        cur.demand.quantity += quantity;
        cur.keys.push(lineKey);
      } else {
        demandBySku.set(k, {
          demand: {
            product_id: productId,
            product_variant_id: variantId ?? undefined,
            quantity,
            product_name: name,
          },
          keys: [lineKey],
        });
      }
    };
    for (const u of updates) {
      if (u.reserve_delta_units > 0) {
        addDemand(
          `existing:${u.line.id}`,
          u.line.product_id,
          u.line.product_variant_id,
          u.reserve_delta_units,
          u.line.product_name,
        );
      }
    }
    for (const a of adds) {
      if (a.reserve) {
        addDemand(
          `add:${a.index}`,
          a.product.id,
          a.variant?.id,
          a.quantity,
          a.product.name,
        );
      }
    }
    const netDemands: Array<{ demand: StockDemandLine; keys: string[] }> = [];
    for (const [k, entry] of demandBySku) {
      entry.demand.quantity -= released.get(k) ?? 0;
      if (entry.demand.quantity > 0) netDemands.push(entry);
    }
    if (netDemands.length > 0) {
      const short = await this.stockValidator.findInsufficientLines(
        netDemands.map((d) => d.demand),
        { tx: opts.tx, kind: 'product' },
      );
      for (const s of short) {
        for (const dk of netDemands) {
          if (
            dk.demand.product_id === s.product_id &&
            (dk.demand.product_variant_id ?? null) === (s.product_variant_id ?? null)
          ) {
            for (const key of dk.keys) {
              const line = lines.find((l) => l.key === key)!;
              if (allowOversell) {
                line.messages.push(
                  'No hay existencias suficientes; la tienda permite sobreventa',
                );
                warnings.push(`Sobreventa: ${s.product_name ?? line.product_name}`);
              } else {
                markBlocked(
                  line,
                  `No hay existencias suficientes de ${s.product_name ?? line.product_name}`,
                  ErrorCodes.INV_STOCK_INSUFFICIENT_LINES.code,
                );
              }
            }
          }
        }
      }
    }

    // ---- descuentos: línea por línea + re-cotización de promo/cupón ----------
    const money = (n: number) => `$${roundMoney2(n)}`;
    const headerDiscount = Number(order.discount_amount ?? 0);
    const before: ItemChangesTotals = {
      subtotal: roundMoney2(Number(order.subtotal_amount ?? 0)),
      discount: roundMoney2(headerDiscount),
      tax: roundMoney2(Number(order.tax_amount ?? 0)),
      tip: roundMoney2(Number(order.tip_amount ?? 0)),
      shipping: roundMoney2(Number(order.shipping_cost ?? 0)),
      grand_total: roundMoney2(Number(order.grand_total ?? 0)),
    };

    const removedIds = new Set(removes.map((r) => r.order_item_id));
    const updateById = new Map(updates.map((u) => [u.line.id, u]));

    interface Resulting {
      line: any;
      quantity: number;
      base: number;
      discount: number | null;
      taxRows: Array<{ id: number; tax_amount: number }>;
      taxTotal: number;
      update: PlannedUpdate | null;
    }
    let currentLineDiscounts = 0; // descuentos de las líneas actuales
    let removedWithDiscount = false;
    const resulting: Resulting[] = [];
    for (const l of activeLines) {
      currentLineDiscounts += Number(l.discount_amount ?? 0);
      if (removedIds.has(l.id)) {
        if (Number(l.discount_amount ?? 0) > 0) removedWithDiscount = true;
        continue;
      }
      const u = updateById.get(l.id) ?? null;
      resulting.push(
        u
          ? {
              line: l,
              quantity: u.new_quantity,
              base: u.new_total_price,
              discount: u.new_discount,
              taxRows: u.new_tax_rows,
              taxTotal: u.new_tax_total,
              update: u,
            }
          : {
              line: l,
              quantity: l.quantity,
              base: Number(l.total_price),
              discount: l.discount_amount != null ? Number(l.discount_amount) : null,
              taxRows: (l.order_item_taxes ?? []).map((t: any) => ({
                id: t.id,
                tax_amount: Number(t.tax_amount ?? 0),
              })),
              taxTotal: resolveOrderLineTaxTotal(l),
              update: null,
            },
      );
    }

    // La orden no puede quedar sin productos (para anularla: Cancelar orden).
    if (resulting.length + adds.length === 0) {
      throw this.invalid(
        'La orden debe tener al menos un producto; para anularla usa Cancelar orden',
      );
    }

    // Promociones / cupón: se RE-COTIZAN sobre el carrito resultante con el
    // mismo motor del editor (`updateOrderFromEditor`).
    const reprices: PlannedReprice[] = [];
    let planBlock: VendixHttpException | null = null;
    let redistributedDiscount: number | null = null;
    let promotionSync: Array<{ promotion_id: number; discount_amount: number }> | null = null;
    let couponUseSync: { id: number; discount_applied: number } | null = null;
    let couponUseRow: { id: number; discount_applied: unknown } | null = null;
    let requotedCouponDiscount: number | null = null;
    // Convención de la orden. line-driven: Σ descuentos de línea ≈ cabecera.
    // header-only (ecommerce/WhatsApp): líneas sin descuento, descuento solo
    // en la cabecera y el impuesto ya calculado ANTES del descuento: nunca se
    // redistribuye en líneas ni se tocan sus impuestos.
    const lineDriven =
      headerDiscount > 0 && Math.abs(currentLineDiscounts - headerDiscount) <= 0.01;
    // mixed: descuentos de línea + un descuento manual de cabecera encima.
    const mixed =
      headerDiscount > 0 &&
      currentLineDiscounts > 0.01 &&
      headerDiscount - currentLineDiscounts > 0.01;
    const manualPart = mixed ? roundMoney2(headerDiscount - currentLineDiscounts) : 0;
    if (mixed) {
      warnings.push(`El descuento manual de la orden (${money(manualPart)}) se mantiene`);
    }
    let headerOverride: number | null = null;
    let quotedSnapshot: Array<{ promotion_id: number; discount_amount: number }> | null = null;
    let couponCode = String(order.coupon_code ?? '').trim();
    // El checkout (WhatsApp/ecommerce) registra el cupón solo en
    // `coupon_uses` (sin `orders.coupon_code`/`coupon_id`): se lee de ahí para
    // re-cotizarlo y no perderlo al editar.
    if (!couponCode && order.coupon_id == null) {
      const use = await db.coupon_uses.findFirst({
        where: { order_id: orderId },
        select: { coupon: { select: { code: true } } },
        orderBy: { id: 'desc' },
      });
      couponCode = String(use?.coupon?.code ?? '').trim();
    }
    const promoIds: number[] = (order.order_promotions ?? [])
      .map((p: any) => p.promotion_id)
      .filter((id: unknown): id is number => typeof id === 'number');
    const hasPromoOrCoupon =
      couponCode.length > 0 || order.coupon_id != null || promoIds.length > 0;
    if (hasPromoOrCoupon) {
      const plannedLines: PlannedOrderLine[] = [
        ...resulting.map((r) => this.plannedLineOfRow(r.line, r.base)),
        ...adds.map((a) => a.planned),
      ];
      const quoteItems = [
        ...resulting.map((r) => ({
          product_id: r.line.product_id as number | null,
          variant_id: r.line.product_variant_id ?? null,
          unit_price: Number(r.line.final_unit_price ?? r.line.unit_price ?? 0),
          quantity: r.quantity,
          tier: r.line.applied_price_tier_id ?? null,
        })),
        ...adds.map((a) => ({
          product_id: a.product.id as number | null,
          variant_id: a.variant?.id ?? null,
          unit_price: a.resolution.finalUnitPrice,
          quantity: a.quantity,
          tier: null,
        })),
      ].filter((it) => it.product_id);

      // Categorías por producto (igual que checkout): sin ellas las promos y
      // cupones por categoría cotizan 0 / lanzan CPN_APPLY_001.
      const categoryMap = new Map<number, number[]>();
      const quoteProductIds = [
        ...new Set(quoteItems.map((it) => it.product_id as number)),
      ];
      if (quoteProductIds.length > 0) {
        const catRows: Array<{ product_id: number; category_id: number }> =
          (await db.product_categories.findMany({
            where: { product_id: { in: quoteProductIds } },
            select: { product_id: true, category_id: true },
          })) ?? [];
        for (const row of catRows) {
          const list = categoryMap.get(row.product_id) ?? [];
          list.push(row.category_id);
          categoryMap.set(row.product_id, list);
        }
      }
      const categoriesOf = (productId: number | null): number[] =>
        productId != null ? (categoryMap.get(productId) ?? []) : [];

      let promotionDiscount = 0;
      let promoSnapshot: Array<{ promotion_id: number; discount_amount: number }> = [];
      let quoted = true;
      try {
        const quote = await this.promotionEngine.quoteDiscounts({
          customer_id: order.customer_id ?? undefined,
          manual_promotion_ids: promoIds,
          exclude_order_id: orderId,
          // Solo las promociones que la orden ya tiene (pausadas incluidas); no
          // entra ninguna nueva.
          order_scope: { promotion_ids: promoIds },
          // Re-cotiza A LA FECHA DE LA ORDEN: lo que aplicaba al crearla no se
          // cae por vencer después ni entran promociones automáticas nuevas.
          as_of: order.created_at ? new Date(order.created_at) : undefined,
          items: quoteItems.map((it, index) => ({
            line_id: index,
            product_id: it.product_id as number,
            variant_id: it.variant_id,
            category_id: null,
            category_ids: categoriesOf(it.product_id),
            unit_price: it.unit_price,
            quantity: Number(it.quantity || 0),
            applied_price_tier_id: it.tier,
            stock_units_consumed: null,
          })),
        } as any);
        promotionDiscount = Number(quote?.total_discount ?? 0);
        promoSnapshot = (quote?.order_promotions_snapshot ?? []).map((sn: any) => ({
          promotion_id: sn.promotion_id,
          discount_amount: Number(sn.discount_amount || 0),
        }));
      } catch (err) {
        quoted = false;
        this.logger.warn(
          `[item-changes] quoteDiscounts failed order=${orderId}: ${(err as Error).message}`,
        );
        const msg = 'No se pudo recalcular la promoción; intenta de nuevo';
        warnings.push(msg);
        planBlock = new VendixHttpException(
          ErrorCodes.ORD_EDIT_PROMOTION_INVALID_001,
          msg,
        );
      }

      let couponDiscount = 0;
      if (quoted && couponCode) {
        try {
          const remaining = Math.max(
            0,
            this.ordersService.grossOfPlannedLines(plannedLines) - promotionDiscount,
          );
          const validation = await this.couponsService.validate({
            code: couponCode,
            cart_subtotal: remaining,
            customer_id: order.customer_id ?? undefined,
            items: quoteItems.map((it) => ({
              product_id: it.product_id as number,
              category_id: null,
              category_ids: categoriesOf(it.product_id),
              line_total: roundMoney2(it.unit_price * Number(it.quantity || 0)),
            })),
            store_id: storeId,
          } as any, {
            excludeOrderId: orderId,
            asOf: order.created_at ? new Date(order.created_at) : undefined,
            // `current_uses` que el editor subió SIN fila coupon_uses.
            orderCouponId: order.coupon_id ?? null,
            orderState: order.state,
          });
          couponUseRow = await db.coupon_uses.findFirst({
            where: { order_id: orderId, coupon_id: validation?.coupon_id ?? order.coupon_id },
            select: { id: true, discount_applied: true },
          });
          couponDiscount = roundMoney2(
            Math.min(validation?.discount_amount || 0, remaining),
          );
          requotedCouponDiscount = couponDiscount;
        } catch (err) {
          // `validate` solo encuentra cupones activos (eliminar = desactivar).
          // Si ESTA orden ya usó el cupón y el comercio lo desactivó después,
          // se respeta y se conserva el monto que ya tenía: no se re-cotiza.
          const usedInactive =
            err instanceof VendixHttpException &&
            err.errorCode === ErrorCodes.CPN_FIND_001.code
              ? await db.coupon_uses.findFirst({
                  where: { order_id: orderId, coupon: { code: couponCode, is_active: false } },
                  select: { id: true, discount_applied: true },
                  orderBy: { id: 'desc' },
                })
              : null;
          if (usedInactive) {
            const remaining = Math.max(
              0,
              this.ordersService.grossOfPlannedLines(plannedLines) - promotionDiscount,
            );
            // El checkout guarda en `discount_applied` solo el cupón, pero el
            // cobro POS (`commitCouponUseForOrder`) guarda TODO el descuento de
            // la orden: el monto del cupón nunca supera lo que ocupaba en la
            // cabecera (sin promociones ni descuento manual).
            const priorPromotions = (order.order_promotions ?? []).reduce(
              (sum: number, p: any) => sum + Number(p.discount_amount ?? 0),
              0,
            );
            const kept = roundMoney2(
              Math.max(
                0,
                Math.min(
                  Number(usedInactive.discount_applied ?? 0),
                  headerDiscount - priorPromotions - manualPart,
                ),
              ),
            );
            couponDiscount = roundMoney2(Math.min(kept, remaining));
            // `requotedCouponDiscount` queda null: la fila `coupon_uses` del
            // cupón inactivo no se reescribe.
            warnings.push(
              couponDiscount < kept
                ? `El cupón ${couponCode} está desactivado: su descuento se reduce de ${money(kept)} a ${money(couponDiscount)} porque supera el nuevo total`
                : `El cupón ${couponCode} está desactivado: se conserva su descuento de ${money(couponDiscount)}`,
            );
          } else if (err instanceof VendixHttpException) {
            // Nunca se descarta un cupón solo: si deja de aplicar, el cambio
            // se bloquea y el usuario ajusta los productos (igual que el editor).
            quoted = false;
            const msg = `Con este cambio el cupón ${couponCode} deja de aplicar (${err.message}). Ajusta los productos para mantenerlo.`;
            warnings.push(msg);
            planBlock = new VendixHttpException(
              ErrorCodes.ORD_EDIT_PROMOTION_INVALID_001,
              msg,
            );
          } else {
            quoted = false;
            this.logger.warn(
              `[item-changes] coupon validate failed order=${orderId}: ${(err as Error).message}`,
            );
            const msg = 'No se pudo recalcular la promoción; intenta de nuevo';
            warnings.push(msg);
            planBlock = new VendixHttpException(
              ErrorCodes.ORD_EDIT_PROMOTION_INVALID_001,
              msg,
            );
          }
        }
      }

      if (quoted) {
        quotedSnapshot = promoSnapshot;
        if (promoIds.length > 0) {
          const prior = new Map<number, number>(
            (order.order_promotions ?? []).map((p: any) => [
              p.promotion_id,
              Number(p.discount_amount ?? 0),
            ]),
          );
          const next = new Map(promoSnapshot.map((p) => [p.promotion_id, p.discount_amount]));
          const named: Array<{ id: number; name: string }> =
            (await db.promotions.findMany({
              where: { id: { in: promoIds } },
              select: { id: true, name: true },
            })) ?? [];
          const nameOf = new Map(named.map((p) => [p.id, p.name]));
          for (const id of promoIds) {
            const a = prior.get(id) ?? 0;
            const b = next.get(id) ?? 0;
            const name = nameOf.get(id) ?? `#${id}`;
            if (a > 0 && b <= 0) {
              warnings.push(
                `La promoción «${name}» deja de aplicar con este cambio (${money(a)} → $0)`,
              );
            } else if (a <= 0 && b > 0) {
              warnings.push(`La promoción «${name}» vuelve a aplicar`);
            }
          }
        }
      }
      if (quoted && !(lineDriven || mixed)) {
        // Header-only o cabecera 0 con promo/cupón: no se redistribuye en
        // líneas; solo la cabecera (D' bruto re-cotizado vs cabecera actual).
        const requoted = roundMoney2(promotionDiscount + couponDiscount);
        if (Math.abs(requoted - headerDiscount) > 0.01) {
          headerOverride = requoted;
          warnings.push(
            `El descuento de la promoción/cupón se recalcula: ${money(headerDiscount)} → ${money(requoted)}`,
          );
        }
      } else if (quoted) {
        const grossDiscount = roundMoney2(promotionDiscount + couponDiscount);
        const kernel = this.ordersService.applyGrossDiscountToPlannedLines(
          plannedLines,
          grossDiscount,
        );
        const lineSum = resulting.reduce((sum, r) => sum + (r.discount ?? 0), 0);
        const redistributes = Math.abs(kernel.baseDiscount - lineSum) > 0.01;
        // D' ≈ Σ descuentos de línea resultantes: nada que redistribuir; las
        // líneas no tocadas quedan intactas.
        if (redistributes) {
          redistributedDiscount = roundMoney2(kernel.baseDiscount);
          const priorDiscount = before.discount;
          warnings.push(
            `El descuento de la promoción/cupón se recalcula: ${money(priorDiscount)} → ${money(redistributedDiscount)} y se reparte entre los productos`,
          );
          resulting.forEach((r, i) => {
            const newDiscount = roundMoney2(kernel.discountByLine[i] ?? 0);
            const newRows = r.taxRows.map((t, k) => ({
              id: t.id,
              tax_amount: kernel.lines[i].taxes[k]?.tax_amount ?? t.tax_amount,
            }));
            const oldDiscount = Number(r.line.discount_amount ?? 0);
            const oldRows = (r.line.order_item_taxes ?? []) as any[];
            const changed =
              Math.abs(newDiscount - (r.update ? (r.discount ?? 0) : oldDiscount)) > 0.001 ||
              newRows.some(
                (t, k) =>
                  Math.abs(
                    t.tax_amount -
                      (r.update
                        ? r.taxRows[k].tax_amount
                        : Number(oldRows[k]?.tax_amount ?? 0)),
                  ) > 0.001,
              );
            const shownBefore = r.update ? (r.discount ?? 0) : oldDiscount;
            r.discount = newDiscount;
            r.taxRows = newRows;
            const kItem = kernel.lines[i].tax_amount_item ?? null;
            const kTax = this.persistedLineTax(
              r.line,
              r.quantity,
              kItem,
              newRows.length,
              kernel.lines[i].line_tax_total,
            );
            r.taxTotal = kTax;
            if (r.update) {
              r.update.new_discount = newDiscount;
              r.update.new_tax_rows = newRows;
              r.update.new_tax_total = kTax;
              r.update.new_tax_amount_item = kItem;
              if (changed) {
                const ul = lines.find((x) => x.key === `existing:${r.line.id}`);
                ul?.messages.push(
                  `Descuento ${money(oldDiscount)} → ${money(newDiscount)}`,
                );
              }
            } else if (changed) {
              reprices.push({
                line: r.line,
                new_discount: newDiscount,
                new_tax_rows: newRows,
                new_tax_amount_item: kItem,
              });
              const k = liveKti(r.line);
              lines.push({
                key: `existing:${r.line.id}`,
                order_item_id: r.line.id,
                product_name: r.line.product_name,
                variant_label: variantLabelOf(r.line),
                action: 'reprice',
                quantity_before: r.line.quantity,
                quantity_after: r.line.quantity,
                kitchen_status: kitchenStatusOf(r.line),
                kitchen_ticket_number: k?.kitchen_ticket?.daily_number ?? null,
                kitchen_effect: 'none',
                stock_effect: 'none',
                requires_cancellation_type: false,
                blocked: false,
                blocked_reason: null,
                messages: [`Descuento ${money(shownBefore)} → ${money(newDiscount)}`],
              });
            }
          });
          adds.forEach((a, k) => {
            const i = resulting.length + k;
            a.discount = roundMoney2(kernel.discountByLine[i] ?? 0);
            a.planned = kernel.lines[i];
            if (a.discount > 0) {
              const al = lines.find((x) => x.key === `add:${a.index}`);
              al?.messages.push(`Descuento ${money(a.discount)}`);
            }
          });
        }
      }
    }

    // ---- totales -------------------------------------------------------------
    let subtotal = 0;
    let tax = 0;
    let lineDiscounts = 0;
    for (const r of resulting) {
      subtotal += r.base;
      tax += r.taxTotal;
      lineDiscounts += r.discount ?? 0;
    }
    for (const a of adds) {
      subtotal += a.resolution.totalPrice;
      tax += a.planned.taxes.reduce((sum, t) => sum + t.tax_amount, 0);
      lineDiscounts += a.discount;
    }
    subtotal = roundMoney2(subtotal);
    tax = roundMoney2(tax);

    // `discountOverride` SOLO si el descuento realmente cambió por el
    // change-set; si no, la cabecera (aunque no cuadre al centavo) queda intacta.
    const discountTouched =
      removedWithDiscount ||
      redistributedDiscount != null ||
      headerOverride != null ||
      resulting.some(
        (r) => Math.abs((r.discount ?? 0) - Number(r.line.discount_amount ?? 0)) > 0.001,
      );
    // order_promotions se sincroniza con lo cotizado SIEMPRE que haya
    // cotización y el descuento haya cambiado.
    if (quotedSnapshot && discountTouched) promotionSync = quotedSnapshot;
    let discountOverride: number | undefined;
    let discount: number;
    if (headerOverride != null) {
      discount = headerOverride;
      discountOverride = headerOverride;
    } else if (redistributedDiscount != null) {
      discount = roundMoney2(Math.min(lineDiscounts + manualPart, subtotal + tax));
      discountOverride = discount;
    } else if (lineDriven || mixed || (hasPromoOrCoupon && discountTouched)) {
      if (discountTouched) {
        discount = roundMoney2(Math.min(lineDiscounts + manualPart, subtotal + tax));
        discountOverride = discount;
      } else {
        discount = roundMoney2(headerDiscount);
      }
    } else {
      discount = Math.min(headerDiscount, subtotal + tax);
      if (headerDiscount > 0) {
        if (discount !== headerDiscount) {
          discountOverride = roundMoney2(discount);
          warnings.push(
            `El descuento de la orden se ajusta de ${money(headerDiscount)} a ${money(discount)} porque supera el nuevo total`,
          );
        } else {
          warnings.push('El descuento fijo de la orden se mantiene igual');
        }
      }
      discount = roundMoney2(discount);
    }
    // `coupon_uses.discount_applied` guarda SOLO el monto del cupón (como lo
    // registra el checkout con `registerUse`), no el descuento de cabecera.
    // Solo si el descuento cambió y el monto del cupón es otro.
    if (
      couponUseRow &&
      discountTouched &&
      requotedCouponDiscount != null &&
      Math.abs(Number(couponUseRow.discount_applied) - requotedCouponDiscount) > 0.001
    ) {
      couponUseSync = { id: couponUseRow.id, discount_applied: requotedCouponDiscount };
    }
    const shipping = before.shipping;
    let tip = before.tip;
    const pct = Number(order.tip_value ?? 0);
    if (order.tip_type === 'percentage' && pct > 0) {
      tip = Math.round(((subtotal + tax) * (pct / 100) + Number.EPSILON) * 100) / 100;
    }
    const after: ItemChangesTotals = {
      subtotal,
      discount,
      tax,
      tip: roundMoney2(tip),
      shipping,
      grand_total: roundMoney2(
        Math.max(0, subtotal + tax + shipping + tip - discount),
      ),
    };

    // Version = updated_at + huella del resumen (totales y, por línea, acción,
    // cantidad, efecto en cocina y montos de precio/descuento resultantes):
    // si precios o estado cambian entre preview y apply, apply lo rechaza.
    const priceByKey = new Map<string, [number, number]>();
    for (const r of resulting) {
      priceByKey.set(`existing:${r.line.id}`, [r.base, r.discount ?? 0]);
    }
    for (const a of adds) {
      priceByKey.set(`add:${a.index}`, [a.resolution.totalPrice, a.discount]);
    }
    const fingerprint = createHash('sha1')
      .update(
        JSON.stringify({
          totals: after,
          lines: lines.map((l) => [
            l.key,
            l.action,
            l.quantity_after,
            l.kitchen_effect,
            ...(priceByKey.get(l.key) ?? [0, 0]),
          ]),
        }),
      )
      .digest('hex')
      .slice(0, 16);
    const version = `${updatedAtIso}|${fingerprint}`;
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== version) {
      throw new VendixHttpException(
        ErrorCodes.ORD_EDIT_INVALID_STATE_001,
        'Los precios o el estado de la orden cambiaron; revisa el resumen y vuelve a confirmar',
      );
    }

    const canApply =
      lines.every((l) => !l.blocked) &&
      awaitingChoice.size === 0 &&
      planBlock == null;

    return {
      preview: {
        order_id: orderId,
        version,
        can_apply: canApply,
        lines,
        totals: { before, after },
        warnings: [...new Set(warnings)],
      },
      order,
      removes,
      updates,
      reprices,
      adds,
      discountOverride,
      promotionSync,
      couponUseSync,
      planBlock,
      blockedCodes,
      allowOversell,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * `tax_amount_item` re-tasado de una línea (impuesto de UNA unidad de
   * precio): `impuesto_de_línea / (total_price / unit_price)`, igual que el
   * kernel del editor. `null` = la línea no lo usa (no se escribe).
   */
  private retaxedTaxAmountItem(l: any, base: number, taxTotal: number): number | null {
    if (l.tax_amount_item == null) return null;
    const unit = Number(l.unit_price);
    const multiplier = unit > 0 ? base / unit : 0;
    return multiplier <= 0 ? Number(l.tax_amount_item) : roundMoney2(taxTotal / multiplier);
  }

  /** Mensaje propio de edición (el de cancelar un ítem no aplica a add/update). */
  private editBlockMessage(
    reason: 'paid' | 'terminal_state' | undefined,
    state: string,
  ): string {
    return reason === 'paid'
      ? 'No se pueden modificar los productos de una orden ya cobrada'
      : `No se pueden modificar los productos de una orden en estado '${state}'`;
  }

  /**
   * Tasa (fracción) de una línea SIN filas `order_item_taxes` (custom del POS):
   * `tax_rate` si existe; si no, impuesto / (total_price − discount_amount),
   * porque el impuesto persistido ya está sobre la base descontada.
   */
  private impliedRateOfRowlessLine(l: any): number {
    // Línea legacy (sin filas y `tax_amount_item` NULL): nadie calculó un
    // impuesto y el recalc tampoco lo persiste; no se inventa uno.
    if (l.tax_amount_item == null) return 0;
    const rate = Number(l.tax_rate ?? 0);
    if (rate > 0) return rate;
    const net = Number(l.total_price ?? 0) - Number(l.discount_amount ?? 0);
    return net > 0 ? resolveOrderLineTaxTotal(l) / net : 0;
  }

  /**
   * Impuesto de línea tal como lo leerá `recalcOrderTotalsFromActiveLinesInTx`
   * (`resolveOrderLineTaxTotal` sobre lo persistido): para líneas sin filas es
   * `tax_amount_item` REDONDEADO × unidades, que puede diferir en centavos del
   * impuesto exacto. Con filas, o sin `tax_amount_item`, queda el exacto.
   */
  private persistedLineTax(
    l: any,
    quantity: number,
    taxAmountItem: number | null,
    rowCount: number,
    exact: number,
  ): number {
    if (rowCount > 0) return exact;
    if (taxAmountItem == null) return 0; // = resolveOrderLineTaxTotal sin desglose
    return resolveOrderLineTaxTotal({
      tax_amount_item: taxAmountItem,
      quantity,
      weight: l.weight,
      price_unit_quantity: l.price_unit_quantity,
      order_item_taxes: [],
    } as any);
  }

  /** Tarifa (fracción) de una fila de impuesto; misma regla del kernel del editor. */
  private rateOfTaxRow(t: any, base: number): number {
    const rate = Number(t.tax_rate ?? 0);
    if (rate > 0) return rate;
    return base > 0 ? Number(t.tax_amount ?? 0) / base : 0;
  }

  /**
   * Plan fiscal de una línea persistida (snapshot), vía el mismo
   * `preservePersistedOrderLine` del editor; con `base` distinta se reescala
   * a la nueva base PRE-descuento (el kernel reconstruye el impuesto como
   * `tarifa × base`).
   */
  private plannedLineOfRow(l: any, base: number): PlannedOrderLine {
    const kept = this.ordersService.preservePersistedOrderLine(
      {
        product_id: l.product_id,
        product_variant_id: l.product_variant_id,
        quantity: l.quantity,
        weight: l.weight,
        unit_price: l.unit_price,
        final_unit_price: l.final_unit_price,
        applied_price_tier_id: l.applied_price_tier_id,
      },
      l.price_unit_quantity,
      [l],
    );
    const rows: any[] = l.order_item_taxes ?? [];
    const planned: PlannedOrderLine = kept ?? {
      unit_price: Number(l.unit_price ?? 0),
      total_price: Number(l.total_price ?? 0),
      tax_rate: l.tax_rate == null ? null : Number(l.tax_rate),
      tax_amount_item: l.tax_amount_item == null ? null : Number(l.tax_amount_item),
      final_unit_price: Number(l.final_unit_price ?? l.unit_price ?? 0),
      line_tax_total: rows.reduce((sum, t) => sum + Number(t.tax_amount ?? 0), 0),
      taxes: rows.map((t) => ({
        tax_rate_id: t.tax_rate_id ?? null,
        tax_name: t.tax_name ?? '',
        tax_rate: Number(t.tax_rate ?? 0),
        tax_amount: Number(t.tax_amount ?? 0),
        tax_type: (t.tax_type ?? null) as string | null,
        is_compound: t.is_compound ?? false,
        is_inclusive: t.is_inclusive ?? false,
      })),
      source: 'preserved_snapshot',
    };
    const oldTotal = Number(l.total_price ?? 0);
    if (rows.length === 0) {
      // Línea sin filas: el kernel toma `line_tax_total` como impuesto
      // PRE-descuento, pero el persistido ya está descontado. Se reconstruye
      // con la tasa implícita sobre la base pre-descuento.
      return {
        ...planned,
        total_price: base,
        line_tax_total: roundMoney2(base * this.impliedRateOfRowlessLine(l)),
      };
    }
    if (Math.abs(base - oldTotal) < 0.0001) return planned;
    return {
      ...planned,
      total_price: base,
      line_tax_total:
        oldTotal > 0 ? roundMoney2(planned.line_tax_total * (base / oldTotal)) : 0,
    };
  }

  /** Plan fiscal PRE-descuento de una línea nueva (precio/impuesto de catálogo). */
  private plannedLineOfAdd(
    res: ReturnType<typeof resolveCatalogLine>,
  ): PlannedOrderLine {
    return {
      unit_price: res.unitBase,
      total_price: res.totalPrice,
      tax_rate: res.taxRate,
      tax_amount_item: res.taxAmountItem,
      final_unit_price: res.finalUnitPrice,
      line_tax_total: res.taxRows.reduce((sum, t) => sum + t.tax_amount, 0),
      taxes: res.taxRows.map(({ row, tax_amount }) => ({
        tax_rate_id: row.tax_rate_id,
        tax_name: row.name,
        tax_rate: Math.round((row.rate + Number.EPSILON) * 100000) / 100000,
        tax_amount,
        tax_type: row.tax_type as string | null,
        is_compound: false,
        is_inclusive: row.is_inclusive,
      })),
      source: 'custom_client',
    };
  }

  private validateChangeSet(dto: OrderItemChangesDto): void {
    const add = dto.add ?? [];
    const update = dto.update ?? [];
    const remove = dto.remove ?? [];
    if (add.length + update.length + remove.length === 0) {
      throw this.invalid('No hay cambios para aplicar');
    }
    const dup = (ids: number[]) => new Set(ids).size !== ids.length;
    const updateIds = update.map((u) => u.order_item_id);
    const removeIds = remove.map((r) => r.order_item_id);
    if (dup(updateIds) || dup(removeIds)) {
      throw this.invalid('Hay líneas repetidas en los cambios');
    }
    if (updateIds.some((id) => removeIds.includes(id))) {
      throw this.invalid('Una línea no puede estar en update y remove a la vez');
    }
  }

  private firstBlock(plan: ItemChangesPlan): VendixHttpException {
    if (plan.planBlock) return plan.planBlock;
    const line = plan.preview.lines.find((l) => l.blocked);
    if (line) {
      const code = plan.blockedCodes.get(line.key);
      const def =
        Object.values(ErrorCodes).find((c: any) => c.code === code) ??
        ErrorCodes.ORD_ITEM_CHANGES_INVALID_001;
      return new VendixHttpException(def as any, line.blocked_reason ?? undefined, {
        key: line.key,
        order_item_id: line.order_item_id,
      });
    }
    const pending = plan.preview.lines.find((l) => l.requires_cancellation_type);
    return this.invalid(
      pending
        ? `Elige reutilizar o desechar los insumos de "${pending.product_name}" antes de quitarlo`
        : 'Los cambios no se pueden aplicar',
    );
  }

  private invalid(message: string): VendixHttpException {
    return new VendixHttpException(
      ErrorCodes.ORD_ITEM_CHANGES_INVALID_001,
      message,
    );
  }

  private requireContext(): { storeId: number; userId?: number } {
    const ctx = RequestContextService.getContext();
    if (!ctx?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return { storeId: ctx.store_id, userId: ctx.user_id };
  }

  /** Mismo patrón que `OrdersService.reserveOrderItemStrict` (allocator + absorbShortfall). */
  private async reserveUnits(
    item: {
      product_id: number;
      product_variant_id: number | null;
      product_name: string;
    },
    required: number,
    orderId: number,
    storeId: number,
    userId: number | undefined,
    tx: Prisma.TransactionClient,
    allowOversell: boolean,
    warnings: InsufficientStockItem[],
  ): Promise<void> {
    const allocation = await this.sellableStockAllocator.allocateForLine(
      storeId,
      item.product_id,
      item.product_variant_id ?? undefined,
      required,
      [],
      tx,
    );
    let slices = allocation.slices;
    if (allocation.shortfall > 0) {
      if (!allowOversell) {
        throw new VendixHttpException(
          ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
          `No hay existencias suficientes de ${item.product_name}.`,
          {
            items: [
              {
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                product_name: item.product_name,
                kind: 'product',
                requested: required,
                available: allocation.available,
              },
            ],
          },
        );
      }
      // Faltante absorbido por sobreventa: no bloquea, pero no es silencioso.
      this.logger.warn(
        `Sobreventa absorbida order=${orderId} product=${item.product_id} variant=${item.product_variant_id ?? 'null'}: pedido=${required} disponible=${allocation.available}`,
      );
      warnings.push({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        product_name: item.product_name,
        kind: 'product',
        requested: required,
        available: allocation.available,
      });
      const fallbackLocationId =
        allocation.slices[0]?.location_id ??
        (await this.stockLevelManager.getDefaultLocationForProduct(
          item.product_id,
          item.product_variant_id ?? undefined,
          tx,
        ));
      slices = this.sellableStockAllocator.absorbShortfall(
        allocation,
        fallbackLocationId,
      );
    }
    for (const slice of slices) {
      await this.stockLevelManager.reserveStock(
        item.product_id,
        item.product_variant_id ?? undefined,
        slice.location_id,
        slice.quantity,
        'order',
        orderId,
        userId,
        !allowOversell,
        tx,
        undefined,
        false,
        undefined,
        allowOversell,
      );
    }
  }
}
