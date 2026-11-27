import type { Logger } from '@nestjs/common';
import type { Prisma, order_state_enum } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { AuditResource, type AuditService } from '@common/audit/audit.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import type { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import type { CouponsService } from '../../coupons/coupons.service';
import type { PromotionEngineService } from '../../promotions/promotion-engine/promotion-engine.service';
import { promotionDiscountByLine } from '../../promotions/promotion-line-discount.util';
import { syncOrderPromotionUsage } from '../../promotions/promotion-usage.util';
import { roundMoney } from '../../products/services/price-unit.util';
import { resolveOrderLineTaxTotal } from '../../taxes/utils/final-price.util';
import type { ApplyOrderCouponDto } from '../dto/apply-order-coupon.dto';
import { SETTLED_PAYMENT_STATES } from '../order-flow/order-cancellation-policy.util';
import type { OrderSseService } from '../services/order-sse.service';
import { assertNoActiveFinancialSplit } from '../shared/financial-split-policy';
import { assertOrderNotInvoiceLocked } from './invoice-lock.util';
import type { PlannedOrderLine } from '../orders.service';

export type ApplyOrderCouponPlannedLine = PlannedOrderLine;

export interface ApplyOrderCouponDeps {
  prisma: StorePrismaService;
  couponsService: CouponsService;
  promotionEngine: PromotionEngineService;
  auditService: AuditService;
  orderSse: OrderSseService;
  logger: Logger;
  plannedLinePreDiscountTax: (line: ApplyOrderCouponPlannedLine) => number;
  grossOfPlannedLines: (lines: ApplyOrderCouponPlannedLine[]) => number;
  sumPlannedOrderLines: (lines: ApplyOrderCouponPlannedLine[]) => {
    subtotal: number;
    tax: number;
  };
  applyGrossDiscountToPlannedLines: (
    lines: ApplyOrderCouponPlannedLine[],
    grossDiscount: number,
    split?: {
      promotionTotal: number;
      promotionByLine: number[] | null;
      couponTotal: number;
    } | null,
  ) => {
    lines: ApplyOrderCouponPlannedLine[];
    discountByLine: number[];
    tax: number;
    baseDiscount: number;
  };
  computeOrderGrandTotal: (args: {
    subtotal: number;
    tax: number;
    discount: number;
    shipping: number;
    tip: number;
  }) => number;
  assertTotalNotBelowPaid: (
    tx: Prisma.TransactionClient,
    orderId: number,
    storeId: number,
    nextGrandTotal: number,
  ) => Promise<void>;
  findOne: (orderId: number) => Promise<unknown>;
}

const ALLOWED_COUPON_EDIT_STATES = new Set<order_state_enum>([
  'draft',
  'created',
  'pending_payment',
]);

/**
 * Applies, replaces, or removes a coupon (or promotion code) on an existing
 * unpaid order without recreating order items or releasing stock reservations.
 *
 * Quota invariant:
 * - `draft` orders never write `coupon_uses` or mutate `coupons.current_uses`;
 *   quota is committed once when the order is paid (`flow/pay` or POS payment).
 * - Non-draft editable orders (`created`, `pending_payment`) create/delete
 *   `coupon_uses` alongside atomic `coupons.current_uses` updates so `flow/pay`
 *   sees the existing `coupon_uses` row and never double-counts or falsely exhausts.
 */
export async function executeApplyOrderCoupon(
  deps: ApplyOrderCouponDeps,
  orderId: number,
  dto: ApplyOrderCouponDto,
) {
  const context = RequestContextService.getContext();
  const storeId = context?.store_id;
  const userId = context?.user_id ?? 0;
  const requestId = context?.request_id;

  if (!storeId) {
    throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
  }

  const existingOrder = (await deps.prisma.orders.findFirst({
    where: { id: orderId, store_id: storeId },
    include: {
      order_items: {
        include: {
          order_item_taxes: { orderBy: { id: 'asc' } },
        },
        orderBy: { id: 'asc' },
      },
      order_promotions: {
        where: { discount_amount: { gt: 0 } },
        select: { promotion_id: true, discount_amount: true },
      },
      coupon_uses: {
        select: {
          id: true,
          coupon_id: true,
          discount_applied: true,
          coupon: { select: { code: true } },
        },
        orderBy: { used_at: 'asc' },
      },
      payments: {
        select: { id: true, amount: true, state: true },
      },
      order_installments: {
        select: { id: true },
      },
    },
  })) as any;

  if (!existingOrder) {
    throw new VendixHttpException(ErrorCodes.ORD_FIND_001);
  }

  assertNoActiveFinancialSplit(existingOrder);
  await assertOrderNotInvoiceLocked(deps.prisma, orderId);

  if (!ALLOWED_COUPON_EDIT_STATES.has(existingOrder.state)) {
    throw new VendixHttpException(
      ErrorCodes.ORD_EDIT_NOT_ALLOWED_001,
      'No se puede modificar el cupón en el estado actual de la orden.',
    );
  }

  if (
    existingOrder.payment_form === '2' &&
    (existingOrder.order_installments?.length ?? 0) > 0
  ) {
    throw new VendixHttpException(
      ErrorCodes.ORD_EDIT_NOT_ALLOWED_001,
      'No se puede modificar el cupón de una orden a crédito con cuotas ya generadas.',
    );
  }

  const settledAmount: number = (existingOrder.payments ?? [])
    .filter((p: { state: string }) =>
      SETTLED_PAYMENT_STATES.has(p.state as any),
    )
    .reduce(
      (sum: number, p: { amount: unknown }) => sum + Number(p.amount ?? 0),
      0,
    );
  const currentGrandTotal = Number(existingOrder.grand_total ?? 0);
  if (
    settledAmount > 0 &&
    currentGrandTotal > 0 &&
    settledAmount >= currentGrandTotal - 0.009
  ) {
    throw new VendixHttpException(
      ErrorCodes.ORD_EDIT_NOT_ALLOWED_001,
      'No se puede modificar el cupón de una orden que ya está pagada.',
    );
  }

  const activeItems: any[] = (existingOrder.order_items ?? []).filter(
    (item: { cancelled_at?: Date | null }) => item.cancelled_at == null,
  );
  if (activeItems.length === 0) {
    throw new VendixHttpException(
      ErrorCodes.ORD_EDIT_NOT_ALLOWED_001,
      'La orden no tiene productos activos para aplicar un cupón.',
    );
  }

  const isDraft = existingOrder.state === 'draft';
  const rawCode = (dto.coupon_code ?? '').trim().toUpperCase();

  const plannedLines: ApplyOrderCouponPlannedLine[] = activeItems.map((item) => {
    const taxes = (item.order_item_taxes ?? []).map((t: any) => ({
      tax_rate_id: t.tax_rate_id ?? null,
      tax_name: t.tax_name ?? '',
      tax_rate: Number(t.tax_rate ?? 0),
      tax_amount: Number(t.tax_amount ?? 0),
      tax_type: (t.tax_type ?? null) as string | null,
      is_compound: Boolean(t.is_compound),
      is_inclusive: Boolean(t.is_inclusive),
    }));
    const base = Number(item.total_price ?? 0);
    const rate = item.tax_rate == null ? null : Number(item.tax_rate);
    // Preserve tax for custom/legacy items without `order_item_taxes` rows:
    // reconstruct pre-discount tax from `tax_rate × base` when a rate exists
    // (so removing a coupon restores full tax), else fall back to persisted
    // `resolveOrderLineTaxTotal(item)`.
    const lineTaxTotal =
      taxes.length > 0
        ? taxes.reduce(
            (sum: number, t: { tax_amount: number }) => sum + t.tax_amount,
            0,
          )
        : rate != null && rate > 0
          ? roundMoney(base * rate)
          : resolveOrderLineTaxTotal(item);
    return {
      unit_price: Number(item.unit_price ?? 0),
      total_price: base,
      tax_rate: rate,
      tax_amount_item:
        item.tax_amount_item == null ? null : Number(item.tax_amount_item),
      final_unit_price: Number(item.final_unit_price ?? item.unit_price ?? 0),
      line_tax_total: lineTaxTotal,
      taxes,
      source: 'preserved_snapshot',
    };
  });

  const codeTarget = rawCode
    ? await deps.promotionEngine.resolveDiscountCode(rawCode)
    : { kind: 'none' as const };
  const codePromotionId =
    codeTarget.kind === 'promotion' ? codeTarget.promotion_id : null;

  const productIds: number[] = Array.from(
    new Set<number>(
      activeItems
        .map((item) => Number(item.product_id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
  const categoryRows = productIds.length
    ? await deps.prisma.product_categories.findMany({
        where: { product_id: { in: productIds } },
        select: { product_id: true, category_id: true },
      })
    : [];
  const categoryMap = new Map<number, number[]>();
  for (const row of categoryRows) {
    const list = categoryMap.get(row.product_id) ?? [];
    list.push(row.category_id);
    categoryMap.set(row.product_id, list);
  }

  let promotionDiscount = 0;
  let promotionByLine: number[] | null = null;
  let promotionSnapshots: { promotion_id: number; discount_amount: number }[] =
    [];
  const ownPromotionIds: number[] = (existingOrder.order_promotions ?? []).map(
    (p: { promotion_id: number }) => Number(p.promotion_id),
  );

  if (ownPromotionIds.length > 0 || codePromotionId != null) {
    const promotionInput = {
      customer_id: existingOrder.customer_id ?? undefined,
      exclude_order_id: orderId,
      manual_promotion_ids: ownPromotionIds,
      items: activeItems
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.product_id)
        .map(({ item, index }) => ({
          line_id: index,
          product_id: item.product_id as number,
          variant_id: item.product_variant_id ?? null,
          category_id: null,
          category_ids: categoryMap.get(Number(item.product_id)) ?? null,
          unit_price: Number(item.final_unit_price ?? item.unit_price ?? 0),
          quantity: Number(item.quantity || 0),
          applied_price_tier_id: item.applied_price_tier_id ?? null,
          stock_units_consumed: null,
        })),
    };
    try {
      const promotionQuote =
        codePromotionId != null
          ? (
              await deps.promotionEngine.quoteWithPromotionCode(
                promotionInput,
                codePromotionId,
              )
            ).quote
          : await deps.promotionEngine.quoteDiscounts(promotionInput);
      promotionDiscount = promotionQuote.total_discount || 0;
      promotionByLine = promotionDiscountByLine(
        promotionQuote,
        activeItems.length,
        (lineId) => (Number.isInteger(Number(lineId)) ? Number(lineId) : null),
      );
      promotionSnapshots = (promotionQuote.order_promotions_snapshot || []).map(
        (s) => ({
          promotion_id: s.promotion_id,
          discount_amount: Number(s.discount_amount || 0),
        }),
      );
    } catch (err) {
      if (codePromotionId != null) {
        if (err instanceof VendixHttpException) throw err;
        throw new VendixHttpException(
          ErrorCodes.ORD_EDIT_PROMOTION_INVALID_001,
        );
      }
      promotionDiscount = (existingOrder.order_promotions ?? []).reduce(
        (sum: number, p: { discount_amount: unknown }) =>
          sum + Number(p.discount_amount ?? 0),
        0,
      );
      promotionSnapshots = (existingOrder.order_promotions ?? []).map(
        (p: { promotion_id: number; discount_amount: unknown }) => ({
          promotion_id: Number(p.promotion_id),
          discount_amount: Number(p.discount_amount ?? 0),
        }),
      );
    }
  }

  // Ecommerce/WhatsApp checkouts persist coupons only in `coupon_uses` leaving
  // `orders.coupon_id` / `orders.coupon_code` null. Read BOTH sources so
  // removing or replacing a checkout coupon always releases its `coupon_uses`.
  const existingUses: Array<{
    id: number;
    coupon_id: number;
    coupon?: { code?: string | null } | null;
  }> = existingOrder.coupon_uses ?? [];
  const existingUseCouponIds = Array.from(
    new Set<number>(
      existingUses
        .map((u) => Number(u.coupon_id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
  const priorCouponIds = Array.from(
    new Set<number>([
      ...(existingOrder.coupon_id ? [Number(existingOrder.coupon_id)] : []),
      ...existingUseCouponIds,
    ]),
  );
  const primaryExistingCouponId: number | null =
    existingOrder.coupon_id ?? existingUseCouponIds[0] ?? null;
  const currentCode = (
    existingOrder.coupon_code ||
    existingUses[0]?.coupon?.code ||
    ''
  )
    .trim()
    .toUpperCase();

  const requestedCode = codePromotionId != null ? '' : rawCode;
  const nextCouponCode = codePromotionId != null ? currentCode : requestedCode;
  const couponChanged =
    nextCouponCode !== currentCode ||
    (!nextCouponCode && priorCouponIds.length > 0);

  let couponId: number | null =
    codePromotionId != null ? primaryExistingCouponId : null;
  let couponDiscount = 0;
  let validatedCouponCode: string | null = null;

  if (nextCouponCode) {
    const remainingSubtotal = Math.max(
      0,
      deps.grossOfPlannedLines(plannedLines) - promotionDiscount,
    );
    const cartItems = activeItems
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.product_id)
      .map(({ item, idx }) => ({
        product_id: item.product_id as number,
        category_id: null,
        category_ids: categoryMap.get(Number(item.product_id)) ?? null,
        line_total: roundMoney(
          Number(plannedLines[idx].total_price) +
            deps.plannedLinePreDiscountTax(plannedLines[idx]),
        ),
      }));

    const validation = await deps.couponsService.validate(
      {
        code: nextCouponCode,
        cart_subtotal: remainingSubtotal,
        customer_id: existingOrder.customer_id ?? undefined,
        items: cartItems,
        store_id: storeId,
      } as any,
      {
        excludeOrderId: orderId,
        orderCouponId: primaryExistingCouponId,
        orderState: existingOrder.state,
        keepInactiveUsedByOrder: !couponChanged,
      },
    );
    couponId = validation.coupon_id;
    validatedCouponCode = (validation.code ?? nextCouponCode).toUpperCase();
    couponDiscount = roundMoney(
      Math.min(validation.discount_amount || 0, remainingSubtotal),
    );
  } else {
    couponId = null;
    validatedCouponCode = null;
    couponDiscount = 0;
  }

  const { subtotal: recalculatedSubtotal } =
    deps.sumPlannedOrderLines(plannedLines);
  const grossDiscountTotal = roundMoney(promotionDiscount + couponDiscount);
  const retaxed = deps.applyGrossDiscountToPlannedLines(
    plannedLines,
    grossDiscountTotal,
    {
      promotionTotal: promotionDiscount,
      promotionByLine,
      couponTotal: couponDiscount,
    },
  );
  const recalculatedTax = retaxed.tax;
  const discountAmount = retaxed.baseDiscount;
  const shippingCost = Number(existingOrder.shipping_cost ?? 0);
  const tipAmount = Number(existingOrder.tip_amount ?? 0);
  const grandTotal = deps.computeOrderGrandTotal({
    subtotal: recalculatedSubtotal,
    tax: recalculatedTax,
    discount: discountAmount,
    shipping: shippingCost,
    tip: tipAmount,
  });

  await deps.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await deps.assertTotalNotBelowPaid(tx, orderId, storeId, grandTotal);

    const claim = await tx.orders.updateMany({
      where: {
        id: orderId,
        store_id: storeId,
        state: existingOrder.state,
      },
      data: { updated_at: new Date() },
    });
    if (claim.count === 0) {
      throw new VendixHttpException(ErrorCodes.ORD_EDIT_STATE_CHANGED_001);
    }

    for (let i = 0; i < activeItems.length; i++) {
      const item = activeItems[i];
      const updatedLine = retaxed.lines[i];
      await tx.order_items.update({
        where: { id: item.id },
        data: {
          discount_amount: retaxed.discountByLine[i],
          tax_amount_item: updatedLine.tax_amount_item,
        },
      });
      const persistedTaxes = item.order_item_taxes ?? [];
      for (let k = 0; k < persistedTaxes.length; k++) {
        const nextTax = updatedLine.taxes[k];
        if (nextTax != null) {
          await tx.order_item_taxes.update({
            where: { id: persistedTaxes[k].id },
            data: { tax_amount: nextTax.tax_amount },
          });
        }
      }
    }

    if (codePromotionId != null || ownPromotionIds.length > 0) {
      await tx.order_promotions.deleteMany({ where: { order_id: orderId } });
      if (promotionSnapshots.length > 0) {
        await tx.order_promotions.createMany({
          data: promotionSnapshots.map((snap) => ({
            order_id: orderId,
            promotion_id: snap.promotion_id,
            customer_id: existingOrder.customer_id ?? null,
            discount_amount: snap.discount_amount,
          })),
        });
      }
      await syncOrderPromotionUsage(
        tx,
        ownPromotionIds,
        promotionSnapshots
          .filter((snap) => snap.discount_amount > 0)
          .map((snap) => snap.promotion_id),
      );
    }

    if (!isDraft) {
      if (couponChanged) {
        for (const oldCouponId of priorCouponIds) {
          if (oldCouponId === couponId) continue;
          const deletedUses = await tx.coupon_uses.deleteMany({
            where: {
              order_id: orderId,
              coupon_id: oldCouponId,
            },
          });
          if (deletedUses.count > 0) {
            await tx.coupons.updateMany({
              where: {
                id: oldCouponId,
                store_id: storeId,
                current_uses: { gt: 0 },
              },
              data: { current_uses: { decrement: 1 } },
            });
          }
        }
        if (couponId) {
          const existingUse = await tx.coupon_uses.findFirst({
            where: { order_id: orderId, coupon_id: couponId },
            select: { id: true },
          });
          if (!existingUse) {
            const couponRow = await tx.coupons.findFirst({
              where: { id: couponId, store_id: storeId },
              select: {
                id: true,
                current_uses: true,
                max_uses: true,
                is_active: true,
              },
            });
            if (!couponRow || !couponRow.is_active) {
              throw new VendixHttpException(ErrorCodes.CPN_FIND_001);
            }
            if (
              couponRow.max_uses != null &&
              couponRow.current_uses >= couponRow.max_uses
            ) {
              throw new VendixHttpException(ErrorCodes.CPN_LIMIT_001);
            }
            const inc = await tx.coupons.updateMany({
              where: {
                id: couponId,
                store_id: storeId,
                is_active: true,
                ...(couponRow.max_uses != null
                  ? { current_uses: { lt: couponRow.max_uses } }
                  : {}),
              },
              data: { current_uses: { increment: 1 } },
            });
            if (inc.count === 0) {
              throw new VendixHttpException(
                ErrorCodes.ORD_EDIT_COUPON_COMMIT_001,
                undefined,
                { stage: 'apply_coupon_increment', coupon_id: couponId },
              );
            }
            await tx.coupon_uses.create({
              data: {
                coupon_id: couponId,
                order_id: orderId,
                customer_id: existingOrder.customer_id ?? null,
                discount_applied: couponDiscount,
              },
            });
          } else {
            await tx.coupon_uses.updateMany({
              where: { order_id: orderId, coupon_id: couponId },
              data: { discount_applied: couponDiscount },
            });
          }
        }
      } else if (couponId) {
        await tx.coupon_uses.updateMany({
          where: { order_id: orderId, coupon_id: couponId },
          data: { discount_applied: couponDiscount },
        });
      }
    }

    // `orders.remaining_balance` is non-nullable (`Decimal @default(0)`).
    // Only touch it when the order already tracks a live partial/manual balance
    // (`remaining_balance > 0` or settled partial payments exist); otherwise
    // keep it at 0 so online-gateway `pending_payment` orders stay in their
    // original payment lane.
    const persistedRemaining = Number(existingOrder.remaining_balance ?? 0);
    const nextRemaining =
      persistedRemaining > 0 || settledAmount > 0
        ? Math.max(0, roundMoney(grandTotal - settledAmount))
        : undefined;

    await tx.orders.update({
      where: { id: orderId },
      data: {
        subtotal_amount: recalculatedSubtotal,
        tax_amount: recalculatedTax,
        discount_amount: discountAmount,
        grand_total: grandTotal,
        ...(nextRemaining !== undefined
          ? { remaining_balance: nextRemaining }
          : {}),
        coupon_id: couponId,
        coupon_code: validatedCouponCode,
        service_version: { increment: 1 },
        updated_at: new Date(),
      },
    });
  });

  try {
    await deps.auditService.logCustom(
      userId,
      validatedCouponCode ? 'order.coupon.applied' : 'order.coupon.removed',
      AuditResource.ORDERS,
      {
        request_id: requestId ?? null,
        store_id: storeId,
        order_id: orderId,
        is_draft: isDraft,
        coupon_code_before: currentCode || null,
        coupon_code_after: validatedCouponCode,
        discount_amount: discountAmount,
        grand_total: grandTotal,
      },
      orderId,
    );
  } catch (auditErr) {
    deps.logger.warn(
      `[applyOrderCoupon] audit event failed: ${(auditErr as Error).message}`,
    );
  }

  deps.orderSse.pushOrderEvent(storeId, orderId, 'order.items.updated', {
    order_number: existingOrder.order_number,
    item_count: activeItems.length,
    is_draft: isDraft,
  });

  return deps.findOne(orderId);
}
