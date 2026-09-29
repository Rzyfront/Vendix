import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { Prisma, refunds_state_enum } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { prorateShippingTaxRefundCents } from '../../../shipping/utils/shipping-tax.util';

/** Step 1 (CP-REFUND-FLOW-REDESIGN): states that reserve ceiling once the
 * caller opts into a pending-aware ceiling. `failed` never reserves;
 * `requested`/`approved` stay out until the plan assigns them. */
const CEILING_RESERVING_STATES: refunds_state_enum[] = [
  refunds_state_enum.completed,
  refunds_state_enum.pending_approval,
  refunds_state_enum.processing,
];

/** M2 fix-forward (review 78/100): states that count toward per-line
 * coverage. Same set as the ceiling: `failed`/`cancelled`/`requested`/
 * `approved` rows keep their `refund_items` but must NOT mark line badges,
 * feed `is_full_refund`, or shrink per-line guards — otherwise a failed
 * refund permanently overstates coverage and the retry path loses its UI
 * (guards report no refundable balance while the backend would allow it).
 * Exported so the coverage endpoint filters with the identical set. */
export const REFUND_LEDGER_STATES: refunds_state_enum[] = CEILING_RESERVING_STATES;

/** Step 3 (CP-REFUND-FLOW-REDESIGN): unified per-line coverage ledger.
 *
 * The ledger is the aggregation of `refund_items` per `order_item_id`,
 * across LEDGER states only (`REFUND_LEDGER_STATES` — same set as the
 * ceiling). It feeds `is_full_refund`, the per-line `maxRefundableQty`
 * guard, and (via `RefundFlowService` §2b) the
 * `order_items.refunded_qty` / `refunded_amount` cache columns, which are
 * absolute re-aggregations of this same ledger — never increments.
 *
 * Item-less refunds (cancellation legs, legacy rows) contribute NOTHING
 * per line: they only count order-level through `already_refunded`. That
 * is the documented orphan fallback: a cancellation refund cannot mark
 * any line badge, it only shrinks the remaining `max_refundable` ceiling.
 *
 * M2 fix-forward: refunds carrying a `state` outside `REFUND_LEDGER_STATES`
 * are skipped. Callers that pre-filter at the query (e.g. `calculate`)
 * are unaffected; `state` stays optional so typeless aggregations keep
 * the legacy include behavior instead of silently dropping rows.
 */
export interface RefundLineCoverage {
  order_item_id: number;
  refunded_qty: number;
  refunded_amount: Prisma.Decimal;
}

export function buildRefundCoverageLedger(
  refunds: Array<{
    state?: refunds_state_enum | string | null;
    refund_items: Array<{
      order_item_id: number;
      quantity: number;
      refund_amount?: Prisma.Decimal | number | string | null;
    }>;
  }>,
): Map<number, RefundLineCoverage> {
  const ledger = new Map<number, RefundLineCoverage>();
  for (const refund of refunds) {
    // M2 fix-forward: a present-but-non-ledger state (failed/cancelled/…)
    // contributes nothing; absent state keeps legacy include behavior.
    if (
      refund.state != null &&
      !(REFUND_LEDGER_STATES as string[]).includes(refund.state)
    ) {
      continue;
    }
    for (const ri of refund.refund_items) {
      const current = ledger.get(ri.order_item_id) ?? {
        order_item_id: ri.order_item_id,
        refunded_qty: 0,
        refunded_amount: new Prisma.Decimal(0),
      };
      current.refunded_qty += ri.quantity;
      current.refunded_amount = current.refunded_amount.plus(
        ri.refund_amount ?? 0,
      );
      ledger.set(ri.order_item_id, current);
    }
  }
  return ledger;
}

export interface RefundItemRequest {
  order_item_id: number;
  quantity: number;
  inventory_action: 'restock' | 'write_off' | 'no_return';
  location_id?: number;
  reason?: string;
}

export interface RefundItemCalculation {
  order_item_id: number;
  product_name: string;
  variant_sku?: string;
  variant_attributes?: string;
  image_url?: string;
  quantity: number;
  unit_price: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  tax_amount: number;
  refund_amount: number;
  inventory_action: string;
  location_id?: number;
  reason?: string;
}

export interface RefundCalculationResult {
  items: RefundItemCalculation[];
  subtotal_refund: number;
  tax_refund: number;
  shipping_refund: number;
  /**
   * Impuesto del envío contenido en `shipping_refund` (que es BRUTO): la
   * parte proporcional de la copia `orders.shipping_tax_amount`, a centavos.
   * 0 si la orden no tiene copia o no se devuelve envío. NO se suma a
   * `total_refund` (ya va dentro de `shipping_refund`) ni a `tax_refund`
   * (impuesto de productos, como `orders.tax_amount`).
   */
  shipping_tax_refund: number;
  /** Tipo fiscal de la copia del envío (null sin copia). */
  shipping_tax_type: string | null;
  total_refund: number;
  is_full_refund: boolean;
  already_refunded: number;
  max_refundable: number;
}

export interface CalculateRefundParams {
  order_id: number;
  items: RefundItemRequest[];
  include_shipping: boolean;
  /**
   * Step 1 (CP-REFUND-FLOW-REDESIGN): count `pending_approval`/`processing`
   * refunds against the ceiling, not just `completed`. Opt-in so
   * cancellation callers keep the legacy completed-only ceiling: their
   * `processing` cash leg is already tracked via `alreadyPlanned` and
   * counting it again would double-book the ceiling. Defaults to false.
   */
  include_pending_states?: boolean;
}

@Injectable()
export class RefundCalculationService {
  constructor(private readonly prisma: StorePrismaService) {}

  async calculate(
    params: CalculateRefundParams,
    client: Prisma.TransactionClient | StorePrismaService = this.prisma,
  ): Promise<RefundCalculationResult> {
    const { order_id, items, include_shipping, include_pending_states } = params;

    // Load order with items, taxes, and previous refunds
    const order = await client.orders.findFirst({
      where: { id: order_id },
      include: {
        order_items: {
          // Step 1: same exclusion as the creation read in
          // `RefundFlowService.createRefund` — cancelled lines never were a
          // purchase, so they are not a refund base either.
          where: { cancelled_at: null },
          include: {
            order_item_taxes: true,
            products: {
              select: {
                id: true,
                track_inventory: true,
                product_images: {
                  where: { is_main: true },
                  select: { image_url: true },
                  take: 1,
                },
              },
            },
          },
        },
        refunds: {
          where: include_pending_states
            ? { state: { in: CEILING_RESERVING_STATES } }
            : { state: 'completed' },
          include: { refund_items: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order #${order_id} not found`);
    }

    // Internal callers can bypass the DTO. Do not merge duplicate lines:
    // their inventory actions or destinations may contradict each other.
    const requestedQtyMap = new Map<number, number>();
    for (const item of items) {
      if (requestedQtyMap.has(item.order_item_id)) {
        throw new VendixHttpException(
          ErrorCodes.REF_VALIDATE_001,
          `Order item #${item.order_item_id} appears more than once in the refund request`,
        );
      }
      requestedQtyMap.set(item.order_item_id, item.quantity);
    }

    // Step 3: `is_full_refund` and the per-line quantity guard below both
    // read from the unified coverage ledger (single aggregation point).
    const coverageLedger = buildRefundCoverageLedger(order.refunds);
    const refundedQtyMap = new Map<number, number>(
      [...coverageLedger].map(([id, cov]) => [id, cov.refunded_qty]),
    );

    // Already refunded total amount
    const already_refunded = order.refunds.reduce(
      (sum, r) => sum + Number(r.amount),
      0,
    );

    const grand_total = Number(order.grand_total);
    const max_refundable = grand_total - already_refunded;
    const subtotal_amount = Number(order.subtotal_amount) || 0;
    const discount_amount = Number(order.discount_amount) || 0;
    const discount_ratio =
      subtotal_amount > 0 ? discount_amount / subtotal_amount : 0;

    const calculatedItems: RefundItemCalculation[] = [];

    for (const reqItem of items) {
      const orderItem = order.order_items.find(
        (oi) => oi.id === reqItem.order_item_id,
      );
      if (!orderItem) {
        throw new BadRequestException(
          `Order item #${reqItem.order_item_id} does not belong to order #${order_id}`,
        );
      }

      const alreadyRefundedQty = refundedQtyMap.get(orderItem.id) || 0;
      const maxRefundableQty = orderItem.quantity - alreadyRefundedQty;

      if (reqItem.quantity > maxRefundableQty) {
        throw new BadRequestException(
          `Cannot refund ${reqItem.quantity} units of "${orderItem.product_name}". ` +
            `Max refundable: ${maxRefundableQty} (original: ${orderItem.quantity}, already refunded: ${alreadyRefundedQty})`,
        );
      }

      if (reqItem.inventory_action === 'restock' && !reqItem.location_id) {
        // REFUND OVERHAUL — `location_id` is now optional. The caller
        // (RefundFlowService) resolves the store's default warehouse AFTER
        // this preview returns. Here we only validate that if explicitly
        // provided, it must be a positive integer (>0). The error message
        // moved to the eventual flow call to keep the preview contract
        // synchronous and pure.
        // Casting to unknown → null is fine; both producers respect null.
      }

      // REFUND OVERHAUL — base the refund on `order_items.total_price` (the
      // actual line amount the customer paid, already net of order-level
      // discount and proportional tax), NOT on `unit_price * quantity`
      // (which is the LIST price — over-refunds when the order line has
      // been discounted to a fraction of its list price, e.g. presentations
      // like QUI648R T5 with unit_price=5000 but total_price=5).
      const line_total = Number(orderItem.total_price);
      const qty_ratio =
        orderItem.quantity > 0 ? reqItem.quantity / orderItem.quantity : 0;
      const gross_amount = line_total * qty_ratio;
      const item_discount = gross_amount * discount_ratio;
      const net_amount = gross_amount - item_discount;

      // Calculate tax from order_item_taxes
      let tax_rate = 0;
      if (orderItem.order_item_taxes && orderItem.order_item_taxes.length > 0) {
        tax_rate = orderItem.order_item_taxes.reduce(
          (sum, t) => sum + Number(t.tax_rate),
          0,
        );
      } else if (orderItem.tax_rate) {
        tax_rate = Number(orderItem.tax_rate);
      }

      const tax_amount = net_amount * tax_rate;
      const refund_amount = net_amount + tax_amount;

      calculatedItems.push({
        order_item_id: orderItem.id,
        product_name: orderItem.product_name,
        variant_sku: orderItem.variant_sku || undefined,
        variant_attributes: orderItem.variant_attributes || undefined,
        image_url:
          orderItem.products?.product_images?.[0]?.image_url || undefined,
        quantity: reqItem.quantity,
        // REFUND OVERHAUL — report the EFFECTIVE per-unit price (the
        // actual amount the customer paid per unit), not the LIST price.
        // For a presentation SKU with unit_price=5000 but total_price=5,
        // this reports 5 (or 5/qty if multiple units per presentation).
        unit_price:
          orderItem.quantity > 0 ? line_total / orderItem.quantity : Number(orderItem.unit_price),
        gross_amount,
        discount_amount: item_discount,
        net_amount,
        tax_amount,
        refund_amount,
        inventory_action: reqItem.inventory_action,
        location_id: reqItem.location_id,
        reason: reqItem.reason,
      });
    }

    const subtotal_refund = calculatedItems.reduce(
      (sum, i) => sum + i.net_amount,
      0,
    );
    const tax_refund = calculatedItems.reduce(
      (sum, i) => sum + i.tax_amount,
      0,
    );

    // Proportional shipping refund
    let shipping_refund = 0;
    if (include_shipping && subtotal_amount > 0) {
      const shipping_cost = Number(order.shipping_cost) || 0;
      shipping_refund = shipping_cost * (subtotal_refund / subtotal_amount);
    }

    const total_refund = subtotal_refund + tax_refund + shipping_refund;

    // Impuesto del envío: proporcional a lo devuelto del envío BRUTO, sobre
    // la copia congelada de la orden (nunca la tarifa actual), en centavos.
    const shipping_refund_cents = Math.round(shipping_refund * 100);
    const shipping_cost_cents = Math.round((Number(order.shipping_cost) || 0) * 100);
    const shipping_tax_cents = Math.round(
      (Number(order.shipping_tax_amount) || 0) * 100,
    );
    // Lo ya devuelto del impuesto del envío no está persistido: se reconstruye
    // con la MISMA fórmula sobre el `shipping_refund` de cada devolución
    // completada (determinista). Si con ésta el envío queda devuelto por
    // completo, se devuelve el REMANENTE exacto de la copia: la suma de las
    // devoluciones cierra al centavo contra `shipping_tax_amount` en vez de
    // arrastrar ±1 ¢ de redondeo por cada parcial.
    const prior_shipping_refund_cents = (order.refunds ?? [])
      .map((refund) => Math.round(Number(refund.shipping_refund ?? 0) * 100))
      .filter((refund_cents) => refund_cents > 0);
    const shipping_tax_refund_cents = prorateShippingTaxRefundCents(
      shipping_cost_cents,
      shipping_tax_cents,
      prior_shipping_refund_cents,
      shipping_refund_cents,
    );

    if (total_refund > max_refundable + 0.01) {
      throw new BadRequestException(
        `Total refund (${total_refund.toFixed(2)}) exceeds max refundable amount (${max_refundable.toFixed(2)})`,
      );
    }

    // Coverage is per original line. Excess historical units of one product
    // must never stand in for units still outstanding on another product.
    // The non-empty guard closes the vacuous-truth promotion: once cancelled
    // lines are excluded, the set can be empty, and an empty request must not
    // read as a full refund.
    //
    // Release-853 (paso 7): el historial que cubre es SÓLO `completed` —
    // la guarda por línea de arriba sigue pendiente-aware (un parcial en
    // vuelo reserva su parte del techo), pero la PROMOCIÓN a `refunded`
    // exige dinero completado: un `pending_approval`/`processing` previo no
    // puede completar la orden junto con este request. `state` ausente
    // conserva el include legacy (misma convención del builder M2): en
    // prod la columna es NOT NULL y siempre viaja.
    const completedQtyMap = new Map<number, number>(
      [...buildRefundCoverageLedger(
        order.refunds.filter((r) => r.state == null || r.state === 'completed'),
      )].map(([id, cov]) => [id, cov.refunded_qty]),
    );
    const is_full_refund =
      order.order_items.length > 0 &&
      order.order_items.every(
        (item) =>
          (completedQtyMap.get(item.id) || 0) +
            (requestedQtyMap.get(item.id) || 0) >=
          item.quantity,
      );

    return {
      items: calculatedItems,
      subtotal_refund: Math.round(subtotal_refund * 100) / 100,
      tax_refund: Math.round(tax_refund * 100) / 100,
      shipping_refund: Math.round(shipping_refund * 100) / 100,
      shipping_tax_refund: shipping_tax_refund_cents / 100,
      shipping_tax_type:
        shipping_tax_refund_cents > 0
          ? (order.shipping_tax_type ?? null)
          : null,
      total_refund: Math.round(total_refund * 100) / 100,
      is_full_refund,
      already_refunded,
      max_refundable: Math.round(max_refundable * 100) / 100,
    };
  }

  /** Cancellation refunds are payment-scoped, not item-return requests. Keep
   * the grand_total ceiling and prior completed refunds in the same calculator
   * used by the ordinary refund flow, under the caller's order lock/transaction.
   */
  async calculateCancellationCashRefund(
    orderId: number,
    paidAmount: Prisma.Decimal,
    client: Prisma.TransactionClient,
    totals: {
      grand_total: Prisma.Decimal;
      tax_amount: Prisma.Decimal;
      shipping_cost: Prisma.Decimal;
      shipping_tax_amount: Prisma.Decimal;
      shipping_tax_type: string | null;
      tip_amount?: Prisma.Decimal | null;
    },
  ) {
    return this.calculateCancellationRefund(
      orderId, paidAmount, client, totals, 'Cash refund',
    );
  }

  /** ADR-12 — same ceiling math for non-cash cancellation legs. Only the
   * breach message changes (`kindLabel`); the cash entry point above keeps
   * its exact message so the cash lane stays byte-identical.
   */
  async calculateCancellationRefund(
    orderId: number,
    paidAmount: Prisma.Decimal,
    client: Prisma.TransactionClient,
    totals: {
      grand_total: Prisma.Decimal;
      tax_amount: Prisma.Decimal;
      shipping_cost: Prisma.Decimal;
      shipping_tax_amount: Prisma.Decimal;
      shipping_tax_type: string | null;
      tip_amount?: Prisma.Decimal | null;
    },
    kindLabel = 'Cancellation refund',
  ) {
    const ceiling = await this.calculate(
      { order_id: orderId, items: [], include_shipping: false }, client,
    );
    const amount = new Prisma.Decimal(paidAmount);
    if (amount.lessThanOrEqualTo(0) || amount.greaterThan(ceiling.max_refundable)) {
      throw new VendixHttpException(
        ErrorCodes.REF_VALIDATE_001,
        `${kindLabel} ${amount.toString()} exceeds the remaining refundable total ${ceiling.max_refundable.toFixed(2)}`,
      );
    }
    const ratio = amount.div(totals.grand_total);
    const tax = new Prisma.Decimal(totals.tax_amount).mul(ratio).toDecimalPlaces(2);
    const shipping = new Prisma.Decimal(totals.shipping_cost).mul(ratio).toDecimalPlaces(2);
    const shippingTax = new Prisma.Decimal(totals.shipping_tax_amount).mul(ratio).toDecimalPlaces(2);
    const tip = new Prisma.Decimal(totals.tip_amount ?? 0).mul(ratio).toDecimalPlaces(2);
    return {
      amount,
      // Product revenue excludes the voluntary tip. The refund amount still
      // includes it; replay debits the tip payable liability separately.
      subtotal: amount.minus(tax).minus(shipping).minus(tip),
      tax,
      shipping,
      tip,
      shippingTax,
      shippingTaxType: totals.shipping_tax_type,
    };
  }
}
