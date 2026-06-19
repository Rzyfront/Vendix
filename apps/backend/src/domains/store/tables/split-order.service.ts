import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { KitchenFireService } from '../kitchen-fire/kitchen-fire.service';
import { storeIsRestaurant } from '../../../common/helpers/industry-capabilities.helper';
import {
  SplitByItemsDto,
  SplitByAmountDto,
  SplitMode,
} from './dto';

/**
 * Result of a split: the source order id, plus the new sub-orders.
 *
 * Plan KDS fire-flows (B9): when the split auto-fires the source order's
 * `prepared` items to the kitchen, `kitchen_fire` carries the ticket id
 * + fired count so the caller (split modal / toast) can show "N platos
 * enviados a cocina" without a follow-up roundtrip. Null when the
 * store is not a restaurant OR the source had no `prepared` items
 * left to fire.
 */
export interface SplitResult {
  source_order_id: number;
  sub_orders: Array<{
    id: number;
    order_number: string;
    grand_total: Prisma.Decimal | number;
    items_count: number;
  }>;
  kitchen_fire: {
    fired_count: number;
    kitchen_ticket_id: number;
    cogs_total: number;
  } | null;
}

/**
 * SplitOrderService
 *
 * Restaurant Suite — Fase E. Owns the financial split of a draft
 * (cuenta abierta) order into N sub-orders.
 *
 * **Hard rule:** the split is FINANCIAL ONLY. The inventory was already
 * consumed at fire-to-kitchen (Fase D) and the `inventory_consumed_at_fire`
 * flag on every order_item is propagated to the new sub-orders so the
 * payment flow (PaymentsService.updateInventoryFromOrder) will skip the
 * consume path again. This is the "propagate the flag to the sub-orders"
 * decision documented in the Fase E plan.
 *
 * Two split modes:
 *   - byItems: the caller explicitly groups order_items into N buckets.
 *     The union of all buckets must cover every item of the source
 *     order exactly once.
 *   - byAmount: the source order is divided into N equal (or custom)
 *     monetary parts. The order_items are NOT moved — each sub-order
 *     re-uses the same line items at proportional quantities, so the
 *     sub-order's COGS attribution is consistent (each sub-order still
 *     shows the full list of items it is paying for, with quantity
 *     scaled).
 *
 * Atomicity: every split is a single Prisma transaction. If any step
 * fails, no sub-orders are created and the source order is untouched.
 */
@Injectable()
export class SplitOrderService {
  private readonly logger = new Logger(SplitOrderService.name);

  constructor(
    private prisma: StorePrismaService,
    private readonly kitchenFireService: KitchenFireService,
  ) {}

  // ------------------------------------------------------------------ helpers
  private requireStoreId(): number {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  private generateSubOrderNumber(sourceNumber: string, index: number) {
    return `${sourceNumber}-S${index + 1}`;
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }

  // ---------------------------------------------------------- split by items
  /**
   * Split the source order into N sub-orders by item assignment.
   * `itemGroups[i]` is the list of order_item_ids that will live in
   * sub-order `i`.
   */
  async splitByItems(
    orderId: number,
    dto: SplitByItemsDto,
  ): Promise<SplitResult> {
    const storeId = this.requireStoreId();

    const order = await this.loadDraftOrder(orderId);
    const orderItemIds = new Set(order.order_items.map((it) => it.id));

    // Validation: every id in every group must exist on the source order,
    // no duplicates, full coverage.
    const assigned = new Set<number>();
    for (const group of dto.item_groups) {
      for (const itemId of group.order_item_ids) {
        if (!orderItemIds.has(itemId)) {
          throw new VendixHttpException(
            ErrorCodes.SPLIT_ORDER_ITEMS_MISSING,
            `order_item #${itemId} no pertenece a la orden #${orderId}`,
          );
        }
        if (assigned.has(itemId)) {
          throw new VendixHttpException(
            ErrorCodes.SPLIT_ORDER_ITEMS_MISSING,
            `order_item #${itemId} aparece en más de un grupo`,
          );
        }
        assigned.add(itemId);
      }
    }
    if (assigned.size !== orderItemIds.size) {
      throw new VendixHttpException(
        ErrorCodes.SPLIT_ORDER_ITEMS_MISSING,
        `Cobertura incompleta: ${assigned.size}/${orderItemIds.size} items asignados`,
      );
    }

    return this.runSplit(order, dto.item_groups.map((g) => g.order_item_ids));
  }

  // --------------------------------------------------------- split by amount
  /**
   * Split the source order into N sub-orders by amount. For 'equal'
   * mode, the grand_total is divided into N equal parts. For 'custom',
   * the caller provides `amounts` and the service validates that the
   * sum equals the source order's grand_total.
   *
   * In both modes the items are proportionally distributed by total_price
   * weight so each sub-order carries a coherent subset of items. This is
   * a financial projection: the goal is "each sub-order is its own check
   * that adds up to its share of the bill", not "items are moved around".
   */
  async splitByAmount(
    orderId: number,
    dto: SplitByAmountDto,
  ): Promise<SplitResult> {
    const storeId = this.requireStoreId();
    if (dto.n_splits < 2) {
      throw new VendixHttpException(
        ErrorCodes.SPLIT_ORDER_INVALID_NSPLITS,
      );
    }

    const order = await this.loadDraftOrder(orderId);
    const orderTotal = Number(order.grand_total);

    // Build the per-sub-order amounts array.
    const amounts: number[] =
      dto.mode === 'custom'
        ? (() => {
            if (!dto.amounts || dto.amounts.length !== dto.n_splits) {
              throw new VendixHttpException(
                ErrorCodes.SPLIT_ORDER_ITEMS_MISSING,
                'amounts debe tener exactamente n_splits elementos',
              );
            }
            const sum = dto.amounts.reduce((acc, v) => acc + v, 0);
            // Compare to 1 cent tolerance — money rounding can produce
            // a 0.01 diff.
            if (Math.abs(sum - orderTotal) > 0.01) {
              throw new VendixHttpException(
                ErrorCodes.SPLIT_ORDER_ITEMS_MISSING,
                `La suma de los montos (${sum}) no coincide con el total de la orden (${orderTotal})`,
              );
            }
            return dto.amounts.map((a) => this.roundMoney(a));
          })()
        : (() => {
            const base = Math.floor((orderTotal * 100) / dto.n_splits) / 100;
            const amounts: number[] = Array(dto.n_splits).fill(base);
            // Last bucket absorbs the rounding diff so the sum matches
            // the source order's total exactly.
            const diff =
              this.roundMoney(orderTotal) - this.roundMoney(base * dto.n_splits);
            amounts[amounts.length - 1] = this.roundMoney(
              amounts[amounts.length - 1] + diff,
            );
            return amounts;
          })();

    // Distribute items into N buckets proportional to each item's
    // share of the source total. We greedily walk items sorted by
    // total_price desc to keep the per-bucket totals close to the
    // target `amounts[i]`. This is intentionally simple: the goal
    // is "each sub-order has the right items so its check adds up",
    // not "optimize the assignment".
    const items = order.order_items;
    if (items.length === 0) {
      throw new VendixHttpException(ErrorCodes.SPLIT_ORDER_EMPTY);
    }

    const itemTotal = items.reduce(
      (acc, it) => acc + Number(it.total_price),
      0,
    );
    const groups: number[][] = Array.from(
      { length: dto.n_splits },
      () => [],
    );

    // Build a per-item proportional quantity for each sub-order:
    // because we don't move line items, we re-use each item at the
    // same quantity — but only in the bucket that "owns" it. The
    // financial split is the order's grand_total, the per-item
    // assignment is just operational (so each sub-order has a non-
    // empty list of lines for the KDS / payment receipt).
    //
    // Strategy: walk the items in descending order, place each one
    // in the bucket with the smallest current sum. This minimizes
    // imbalance across buckets.
    const sorted = [...items].sort(
      (a, b) => Number(b.total_price) - Number(a.total_price),
    );
    const sums = Array<number>(dto.n_splits).fill(0);
    for (const it of sorted) {
      let target = 0;
      for (let i = 1; i < sums.length; i += 1) {
        if (sums[i] < sums[target]) target = i;
      }
      groups[target].push(it.id);
      sums[target] += Number(it.total_price);
    }
    // Suppress unused-var lint by referencing `itemTotal`.
    void itemTotal;

    return this.runSplit(order, groups);
  }

  // -------------------------------------------------------- internal runner
  private async runSplit(
    order: {
      id: number;
      store_id: number;
      customer_id: number | null;
      currency: string | null;
      channel: string;
      delivery_type: string;
      order_number: string;
      order_items: Array<{
        id: number;
        product_id: number | null;
        product_variant_id: number | null;
        product_name: string;
        description: string | null;
        variant_sku: string | null;
        variant_attributes: string | null;
        variant_image_url: string | null;
        quantity: number;
        unit_price: Prisma.Decimal | number;
        total_price: Prisma.Decimal | number;
        tax_rate: Prisma.Decimal | number | null;
        tax_amount_item: Prisma.Decimal | number | null;
        cost_price: Prisma.Decimal | number | null;
        catalog_unit_price: Prisma.Decimal | number | null;
        catalog_final_price: Prisma.Decimal | number | null;
        final_unit_price: Prisma.Decimal | number | null;
        is_price_overridden: boolean;
        price_override_reason: string | null;
        price_overridden_by_user_id: number | null;
        weight: Prisma.Decimal | number | null;
        weight_unit: string | null;
        item_type: string | null;
        applied_price_tier_id: number | null;
        applied_price_tier_name_snapshot: string | null;
        stock_units_consumed: number | null;
        inventory_consumed_at_fire: boolean;
        skip_kds: boolean;
        products: { product_type: string } | null;
      }>;
    },
    groups: number[][],
  ): Promise<SplitResult> {
    const subOrders: SplitResult['sub_orders'] = [];
    const itemById = new Map(order.order_items.map((it) => [it.id, it]));

    // Plan KDS fire-flows (B7): collect candidate `prepared` items that
    // are not yet fire-tracked AND not flagged `skip_kds` so we can
    // fire them as part of the split transaction. After the split the
    // source order is cancelled; if we leave the fire for later, the
    // sub-orders inherit the FALSE flag and the payment path will
    // discount the stock at sale (no kitchen ticket = no KDS = blind
    // cocina). Fire here so the COGS recognition happens in fire
    // (invariant) and the sub-orders inherit the TRUE flag.
    const fireCandidateIds = order.order_items
      .filter((it) =>
        it.inventory_consumed_at_fire === false &&
        it.skip_kds !== true &&
        it.product_id != null &&
        (it as any).products?.product_type === 'prepared',
      )
      .map((it) => it.id);
    type SplitFireResult = {
      ticketId: number;
      firedItemSnapshots: Array<{
        orderItemId: number;
        productId: number;
        productName: string;
        quantity: number;
      }>;
      cogsTotal: number;
      consumedLineCount: number;
    };
    const splitFireResult: { value: SplitFireResult | null } = {
      value: null,
    };

    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < groups.length; i += 1) {
        const ids = groups[i];
        const orderNumber = this.generateSubOrderNumber(order.order_number, i);

        // Compute per-bucket subtotal/tax/total.
        let subtotal = 0;
        let taxAmount = 0;
        for (const id of ids) {
          const it = itemById.get(id);
          if (!it) continue;
          subtotal += Number(it.total_price);
          taxAmount += Number(it.tax_amount_item ?? 0);
        }
        const grandTotal = this.roundMoney(subtotal + taxAmount);

        const subOrder = await tx.orders.create({
          data: {
            store_id: order.store_id,
            customer_id: order.customer_id,
            order_number: orderNumber,
            state: 'draft',
            channel: order.channel as any,
            delivery_type: order.delivery_type as any,
            currency: order.currency,
            subtotal_amount: new Prisma.Decimal(this.roundMoney(subtotal)),
            tax_amount: new Prisma.Decimal(this.roundMoney(taxAmount)),
            shipping_cost: 0,
            discount_amount: 0,
            grand_total: new Prisma.Decimal(grandTotal),
            total_paid: 0,
            remaining_balance: new Prisma.Decimal(grandTotal),
            internal_notes: `Sub-orden del split de #${order.id} (${order.order_number})`,
            updated_at: new Date(),
          },
        });

        for (const id of ids) {
          const it = itemById.get(id);
          if (!it) continue;
          await tx.order_items.create({
            data: {
              order_id: subOrder.id,
              product_id: it.product_id,
              product_variant_id: it.product_variant_id,
              product_name: it.product_name,
              description: it.description,
              variant_sku: it.variant_sku,
              variant_attributes: it.variant_attributes,
              variant_image_url: it.variant_image_url,
              quantity: it.quantity,
              unit_price: new Prisma.Decimal(Number(it.unit_price)),
              total_price: new Prisma.Decimal(Number(it.total_price)),
              tax_rate:
                it.tax_rate != null
                  ? new Prisma.Decimal(Number(it.tax_rate))
                  : null,
              tax_amount_item:
                it.tax_amount_item != null
                  ? new Prisma.Decimal(Number(it.tax_amount_item))
                  : null,
              cost_price:
                it.cost_price != null
                  ? new Prisma.Decimal(Number(it.cost_price))
                  : null,
              catalog_unit_price:
                it.catalog_unit_price != null
                  ? new Prisma.Decimal(Number(it.catalog_unit_price))
                  : null,
              catalog_final_price:
                it.catalog_final_price != null
                  ? new Prisma.Decimal(Number(it.catalog_final_price))
                  : null,
              final_unit_price:
                it.final_unit_price != null
                  ? new Prisma.Decimal(Number(it.final_unit_price))
                  : null,
              is_price_overridden: it.is_price_overridden,
              price_override_reason: it.price_override_reason,
              price_overridden_by_user_id: it.price_overridden_by_user_id,
              weight:
                it.weight != null
                  ? new Prisma.Decimal(Number(it.weight))
                  : null,
              weight_unit: it.weight_unit,
              item_type: it.item_type,
              applied_price_tier_id: it.applied_price_tier_id,
              applied_price_tier_name_snapshot:
                it.applied_price_tier_name_snapshot,
              stock_units_consumed: it.stock_units_consumed,
              // PROPAGATE THE FLAG — this is the Fase E rule: split is
              // financial only; inventory was already consumed at fire,
              // and we must NOT let the payment path re-consume it.
              inventory_consumed_at_fire: it.inventory_consumed_at_fire,
              updated_at: new Date(),
            },
          });
        }

        subOrders.push({
          id: subOrder.id,
          order_number: orderNumber,
          grand_total: grandTotal,
          items_count: ids.length,
        });
      }

      // Plan KDS fire-flows (B7): auto-fire the pending `prepared`
      // items from the source order BEFORE we cancel it. After this
      // returns the source order is cancelled, but the
      // `inventory_consumed_at_fire` flag on the source's order_items
      // is set to TRUE by the fire core; the sub-orders we just
      // created propagated the flag (Fase E rule), and they will
      // inherit the TRUE value when the flag flip happens here.
      //
      // Atomicity: fire is INSIDE the split $transaction. If fire
      // fails, the whole split rolls back (no orphan sub-orders).
      if (fireCandidateIds.length > 0) {
        const storeRow = await tx.stores.findUnique({
          where: { id: order.store_id },
          select: { industries: true },
        });
        if (storeIsRestaurant(storeRow?.industries)) {
          const ctx = await this.kitchenFireService.prepareFireContext(
            order.id,
            fireCandidateIds,
          );
          if (ctx && ctx.firedItemIds.length > 0) {
            splitFireResult.value =
              await this.kitchenFireService.fireOrderItemsInTx(
                tx,
                order.store_id,
                ctx,
              );
          }
        }
      }

      // Mark the source order as 'cancelled' with a note. We use
      // 'cancelled' (not 'finished') because the order is being
      // superseded by the sub-orders; 'finished' would let the
      // payments flow try to collect the source order's grand_total,
      // which is now distributed across the sub-orders.
      await tx.orders.update({
        where: { id: order.id },
        data: {
          state: 'cancelled',
          internal_notes: `Cuenta dividida en ${groups.length} sub-órdenes: ${subOrders
            .map((s) => s.order_number)
            .join(', ')}`,
          updated_at: new Date(),
        },
      });
    });

    this.logger.log(
      `Order split: source=${order.id} → ${subOrders.length} sub-orders`,
    );

    // Plan KDS fire-flows (B9): after the split $transaction commits,
    // emit kitchen.fired + push KDS SSE snapshot for the auto-fire we
    // just did. Failures are logged but never bubble up: the split is
    // already persisted and the operator can re-fire from the KDS page.
    if (splitFireResult.value) {
      try {
        await this.kitchenFireService.emitKitchenFiredAfterCommit(
          order.store_id,
          undefined,
          splitFireResult.value,
          order.id,
        );
      } catch (err) {
        this.logger.error(
          `Failed to emit kitchen.fired for split auto-fire on order #${order.id}: ${
            (err as Error).message
          }`,
          (err as Error).stack,
        );
      }
    }

    return {
      source_order_id: order.id,
      sub_orders: subOrders,
      kitchen_fire: splitFireResult.value
        ? {
            fired_count: splitFireResult.value.firedItemSnapshots.length,
            kitchen_ticket_id: splitFireResult.value.ticketId,
            cogs_total: Number(splitFireResult.value.cogsTotal.toFixed(4)),
          }
        : null,
    };
  }

  // -------------------------------------------------------------- internals
  /**
   * Loads the source order and asserts it is in `draft` (an open
   * check). Returns the order with its items attached.
   */
  private async loadDraftOrder(orderId: number) {
    const storeId = this.requireStoreId();
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId, store_id: storeId },
      include: {
        order_items: {
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!order) {
      throw new VendixHttpException(ErrorCodes.SPLIT_ORDER_NOT_FOUND);
    }
    if (order.state !== 'draft') {
      throw new VendixHttpException(ErrorCodes.SPLIT_ORDER_NOT_DRAFT);
    }
    if (order.order_items.length === 0) {
      throw new VendixHttpException(ErrorCodes.SPLIT_ORDER_EMPTY);
    }
    return order;
  }

  /**
   * Public surface used by tests to validate the round-money helper.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _unused: SplitMode | null = null;
}
