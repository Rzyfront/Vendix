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
import { OrdersService } from '../orders.service';
import { OrderSseService } from '../services/order-sse.service';
import { assertNoActiveFinancialSplit } from '../shared/financial-split-policy';
import { assertVariantRequiredForPrepared } from '../utils/variant-required.validator';
import {
  FullTaxRow,
  resolveCatalogLine,
  resolveCatalogUnitPrice,
  resolveFullTaxRowsByProductId,
} from '../utils/catalog-line-pricing.util';
import { roundMoney2 } from '../../taxes/utils/final-price.util';
import { KitchenFireService } from '../../kitchen-fire/kitchen-fire.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import {
  StockValidatorService,
  StockDemandLine,
} from '../../inventory/shared/services/stock-validator.service';
import { SellableStockAllocator } from '../../inventory/shared/services/sellable-stock-allocator.service';
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
  action: 'add' | 'increase' | 'decrease' | 'remove';
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
  ratio: number;
  new_total_price: number;
  new_discount: number | null;
  new_stock_units: number | null;
  new_tax_rows: Array<{ id: number; tax_amount: number }>;
  reserve_delta_units: number; // >0 reservar, <0 liberar, 0 nada
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
}

interface ItemChangesPlan {
  preview: ItemChangesPreview;
  order: any;
  removes: PlannedRemove[];
  updates: PlannedUpdate[];
  adds: PlannedAdd[];
  discountOverride?: number;
  blockedCodes: Map<string, string>; // line key -> error code
  allowOversell: boolean;
}

const TERMINAL_ORDER_STATES = ['draft', 'created'];

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
        await this.orderFlowService.assertOrderItemsCancellableInTx(
          tx,
          orderId,
          storeId,
        );
        const plan = await this.buildPlan(tx, orderId, dto, {
          tx,
          expectedVersion: dto.expected_version,
        });
        if (!plan.preview.can_apply) {
          throw this.firstBlock(plan);
        }
        const order = { ...plan.order, id: orderId };

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
              tax_amount_item: new Prisma.Decimal(res.taxAmountItem),
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
              ...(a.rows.length > 0
                ? {
                    order_item_taxes: {
                      create: res.taxRows.map(({ row, tax_amount }) => ({
                        tax_rate_id: row.tax_rate_id,
                        tax_name: row.name,
                        tax_rate:
                          Math.round((row.rate + Number.EPSILON) * 100000) /
                          100000,
                        tax_amount,
                        tax_type: row.tax_type,
                        is_compound: false,
                        is_inclusive: row.is_inclusive,
                      })),
                    },
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

        return { plan, cancelEffects, fireResult, newItemIds };
      },
      { timeout: 20_000, maxWait: 5_000 },
    );

    const { plan, cancelEffects, fireResult, newItemIds } = txResult;

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
    if (fireResult) {
      try {
        await this.kitchenFireService.emitKitchenFiredAfterCommit(
          storeId,
          undefined,
          fireResult,
          orderId,
        );
      } catch (err) {
        this.logger.error(
          `emitKitchenFiredAfterCommit failed order=${orderId}: ${(err as Error).message}`,
        );
      }
    }
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

    const order = await this.ordersService.findOne(orderId);
    return { order, summary: plan.preview };
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
        order_promotions: { select: { id: true }, take: 1 },
      },
    });
    if (!order) throw new VendixHttpException(ErrorCodes.ORD_FIND_001);

    const version = order.updated_at ? new Date(order.updated_at).toISOString() : '';
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== version) {
      throw new VendixHttpException(
        ErrorCodes.ORD_EDIT_INVALID_STATE_001,
        'La orden cambió mientras editabas. Revisa los cambios.',
      );
    }
    if (!TERMINAL_ORDER_STATES.includes(order.state)) {
      throw new VendixHttpException(ErrorCodes.ORD_EDIT_NOT_ALLOWED_001);
    }
    assertNoActiveFinancialSplit(order);
    await this.ordersService.assertTableOrderEditable(orderId, storeId);

    // Guarda de orden (pagada / terminal): la misma que aplica `apply`.
    const orderBlock = this.orderFlowService.getOrderItemCancelBlock(order);

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

    const reservesStock =
      order.state === 'created' || (order.table_sessions?.length ?? 0) > 0;
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
        } else if (!c.wasFired && isTracked(l)) {
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
      updates.push({
        line: l,
        new_quantity: u.quantity,
        ratio,
        new_total_price: roundMoney2(Number(l.total_price) * ratio),
        new_discount:
          l.discount_amount != null
            ? roundMoney2(Number(l.discount_amount) * ratio)
            : null,
        new_stock_units: newStockUnits,
        new_tax_rows: (l.order_item_taxes ?? []).map((t: any) => ({
          id: t.id,
          tax_amount: roundMoney2(Number(t.tax_amount) * ratio),
        })),
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
        });
      }
    }

    // ---- stock disponible (no lanza; marca la línea) ---------------------------
    const inventoryPolicy = await this.stockValidator.resolveInventoryPolicy(
      storeId,
      opts.tx,
    );
    const allowOversell = inventoryPolicy.allowOversell === true;
    const demandKeys: Array<{ key: string; demand: StockDemandLine }> = [
      ...updates
        .filter((u) => u.reserve_delta_units > 0)
        .map((u) => ({
          key: `existing:${u.line.id}`,
          demand: {
            product_id: u.line.product_id,
            product_variant_id: u.line.product_variant_id,
            quantity: u.reserve_delta_units,
            product_name: u.line.product_name,
          } as StockDemandLine,
        })),
      ...adds
        .filter((a) => a.reserve)
        .map((a) => ({
          key: `add:${a.index}`,
          demand: {
            product_id: a.product.id,
            product_variant_id: a.variant?.id ?? undefined,
            quantity: a.quantity,
            product_name: a.product.name,
          } as StockDemandLine,
        })),
    ];
    const warnings: string[] = [];
    if (demandKeys.length > 0) {
      const short = await this.stockValidator.findInsufficientLines(
        demandKeys.map((d) => d.demand),
        { tx: opts.tx, kind: 'product' },
      );
      for (const s of short) {
        for (const dk of demandKeys) {
          if (
            dk.demand.product_id === s.product_id &&
            (dk.demand.product_variant_id ?? null) === (s.product_variant_id ?? null)
          ) {
            const line = lines.find((l) => l.key === dk.key)!;
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

    // ---- totales -------------------------------------------------------------
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
    let subtotal = 0;
    let tax = 0;
    let lineDiscounts = 0; // descuentos de las líneas resultantes
    let currentLineDiscounts = 0; // descuentos de las líneas actuales
    const sumTaxes = (l: any) =>
      (l.order_item_taxes ?? []).reduce(
        (s: number, t: any) => s + Number(t.tax_amount ?? 0),
        0,
      );
    for (const l of activeLines) {
      currentLineDiscounts += Number(l.discount_amount ?? 0);
      if (removedIds.has(l.id)) continue;
      const u = updateById.get(l.id);
      if (u) {
        subtotal += u.new_total_price;
        tax += u.new_tax_rows.reduce((s, t) => s + t.tax_amount, 0);
        lineDiscounts += u.new_discount ?? 0;
      } else {
        subtotal += Number(l.total_price);
        tax += sumTaxes(l);
        lineDiscounts += Number(l.discount_amount ?? 0);
      }
    }
    for (const a of adds) {
      subtotal += a.resolution.totalPrice;
      tax += a.resolution.taxRows.reduce((s, t) => s + t.tax_amount, 0);
    }
    subtotal = roundMoney2(subtotal);
    tax = roundMoney2(tax);

    let discountOverride: number | undefined;
    let discount: number;
    const lineDriven =
      headerDiscount > 0 && Math.abs(currentLineDiscounts - headerDiscount) <= 0.01;
    if (lineDriven) {
      discount = roundMoney2(lineDiscounts);
      discountOverride = discount;
    } else {
      discount = Math.min(headerDiscount, subtotal + tax);
      if (headerDiscount > 0) {
        warnings.push('El descuento fijo de la orden se mantiene igual');
        if (discount !== headerDiscount) discountOverride = roundMoney2(discount);
      }
      discount = roundMoney2(discount);
    }
    if (order.coupon_code || (order.order_promotions?.length ?? 0) > 0) {
      warnings.push(
        'Las promociones y cupones no se recalculan automáticamente; el descuento se ajusta a los productos que quedan',
      );
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

    const canApply =
      lines.every((l) => !l.blocked) && awaitingChoice.size === 0;

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
      adds,
      discountOverride,
      blockedCodes,
      allowOversell,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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
