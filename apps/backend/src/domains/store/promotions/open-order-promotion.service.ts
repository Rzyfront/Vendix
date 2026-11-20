import { Injectable, Logger } from '@nestjs/common';
import { PromotionEngineService } from './promotion-engine/promotion-engine.service';
import type {
  PromotionQuoteItemInput,
  PromotionQuoteResult,
} from './dto/promotion-quote.interface';
import { promotionDiscountByLine } from './promotion-line-discount.util';
import {
  loadCategoryIdsByProduct,
  persistedLineToPromotionQuoteItem,
  retaxOpenOrderLines,
} from './open-order-promotion.util';

const roundMoney = (value: number): number =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export interface OpenOrderRepriceResult {
  /** Σ `total_price` de las líneas vivas (base pre-descuento). */
  subtotal: number;
  /** Impuesto POST-descuento. */
  tax_amount: number;
  /** Descuento de BASE (contrato de `orders.discount_amount`). */
  discount_amount: number;
  /** subtotal + impuesto − descuento (sin envío ni propina). */
  items_total: number;
}

/**
 * La cuenta abierta de una mesa refleja la promoción ANTES del cobro.
 *
 * Cotiza el motor sobre las líneas vivas persistidas y deja el resultado en
 * las líneas con la misma regla del cobro (`retaxOpenOrderLines`): descuento
 * de BASE en `order_items.discount_amount` e impuesto recalculado sobre la
 * base descontada. NO registra `order_promotions` ni consume `usage_count`:
 * eso ocurre sólo al cobrar, que recotiza con el mismo util.
 *
 * Si el motor falla, degrada a sin descuento (nunca rompe la toma de pedido).
 * El caller escribe la cabecera con el resultado.
 */
@Injectable()
export class OpenOrderPromotionService {
  private readonly logger = new Logger(OpenOrderPromotionService.name);

  constructor(private readonly promotionEngine: PromotionEngineService) {}

  async repriceInTx(tx: any, orderId: number): Promise<OpenOrderRepriceResult> {
    const [order, lines] = await Promise.all([
      tx.orders.findFirst({
        where: { id: orderId },
        select: { customer_id: true },
      }),
      tx.order_items.findMany({
        where: { order_id: orderId, cancelled_at: null },
        include: { order_item_taxes: true },
        orderBy: { id: 'asc' },
      }),
    ]);

    const quote = await this.quote(tx, orderId, order?.customer_id ?? null, lines);
    const promotionTotal = roundMoney(Number(quote?.total_discount) || 0);
    const retax = await retaxOpenOrderLines(tx, lines, [], promotionTotal, {
      promotionTotal,
      couponTotal: 0,
      promotionByLine: promotionDiscountByLine(quote, lines.length, (lineId) => {
        const index = Number(lineId);
        return Number.isInteger(index) && index >= 0 && index < lines.length
          ? index
          : null;
      }),
    });

    const subtotal = roundMoney(
      lines.reduce(
        (sum: number, line: any) => sum + Number(line.total_price || 0),
        0,
      ),
    );
    return {
      subtotal,
      tax_amount: retax.tax_amount,
      discount_amount: retax.discount_amount_base,
      items_total: roundMoney(
        Math.max(0, subtotal + retax.tax_amount - retax.discount_amount_base),
      ),
    };
  }

  private async quote(
    tx: any,
    orderId: number,
    customerId: number | null,
    lines: any[],
  ): Promise<PromotionQuoteResult | null> {
    try {
      const categoryIds = await loadCategoryIdsByProduct(
        tx,
        lines.map((line) => Number(line.product_id)),
      );
      const items = lines
        .map((line, index) =>
          persistedLineToPromotionQuoteItem(line, index, categoryIds),
        )
        .filter((item): item is PromotionQuoteItemInput => item != null);
      if (items.length === 0) return null;
      // Promociones por código ya registradas en la orden: se conservan, igual
      // que en el cobro.
      const own: Array<{ promotion_id: number }> =
        (await tx.order_promotions.findMany({
          where: { order_id: orderId, discount_amount: { gt: 0 } },
          select: { promotion_id: true },
        })) ?? [];
      return await this.promotionEngine.quoteDiscounts({
        customer_id: customerId,
        exclude_order_id: orderId,
        manual_promotion_ids: Array.from(
          new Set(own.map((row) => Number(row.promotion_id))),
        ),
        items,
      });
    } catch (error) {
      this.logger.warn(
        `[open-order] quoteDiscounts failed order=${orderId}, falling back to no-discount: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
