import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, Max, Min } from 'class-validator';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { OrderFlowService } from '../orders/order-flow/order-flow.service';
import { assertNoActiveFinancialSplit } from '../orders/shared/financial-split-policy';
import {
  FullTaxRow,
  resolveCatalogLine,
  resolveCatalogUnitPrice,
  resolveFullTaxRowsByProductId,
} from '../orders/utils/catalog-line-pricing.util';
import { assertSaleNatureProducts } from '../products/services/product-usage-nature.util';

/** QUI-1063 — "Agregar cargo" of a service booking. */
export class AddBookingChargeDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  product_id!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  product_variant_id?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

/** Order states still open to new lines (nothing invoiced or closed yet). */
export const BOOKING_CHARGE_OPEN_STATES = ['created', 'pending_payment', 'draft'] as const;
const CLOSED_BOOKING_STATUSES = ['cancelled', 'no_show'];

/**
 * QUI-1063 — an extra of a service booking (a product or service sold during
 * the appointment) goes on the booking's order at once, with catalog price
 * and taxes, and the order's total and pending balance follow it. The order
 * is then charged through its normal flow (Orders / POS). Like the hotel
 * folio, the line never touches inventory: items with stock are sold from
 * the POS. Nothing is announced to accounting: the order books at payment or
 * invoice, as every open order.
 */
@Injectable()
export class BookingChargesService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly orderFlow: OrderFlowService,
  ) {}

  async addCharge(booking_id: number, dto: AddBookingChargeDto): Promise<void> {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    const booking = await this.prisma.bookings.findFirst({
      where: { id: booking_id },
      select: { id: true, status: true, order_id: true, booking_number: true },
    });
    if (!booking) throw new VendixHttpException(ErrorCodes.BOOKING_CHARGE_001, 'Reserva no encontrada');
    if (CLOSED_BOOKING_STATUSES.includes(booking.status)) {
      throw new VendixHttpException(
        ErrorCodes.BOOKING_CHARGE_001,
        'La reserva está cancelada o no se presentó: no admite cargos',
      );
    }
    if (!booking.order_id) {
      throw new VendixHttpException(ErrorCodes.BOOKING_CHARGE_001, 'Esta reserva no tiene orden asociada');
    }

    const product = await this.prisma.products.findFirst({
      where: { id: dto.product_id },
      select: {
        id: true,
        name: true,
        base_price: true,
        is_on_sale: true,
        sale_price: true,
        is_sellable: true,
        usage_nature: true,
        state: true,
        product_type: true,
        track_inventory: true,
        price_unit_quantity: true,
        product_variants: {
          select: {
            id: true,
            name: true,
            price_override: true,
            is_on_sale: true,
            sale_price: true,
            track_inventory_override: true,
          },
        },
      },
    });
    if (product) assertSaleNatureProducts([product]);
    if (!product || !product.is_sellable || product.state !== 'active') {
      throw new VendixHttpException(ErrorCodes.BOOKING_CHARGE_001, 'El producto no existe o no se puede vender');
    }
    const variant =
      dto.product_variant_id != null
        ? product.product_variants.find((v) => v.id === dto.product_variant_id)
        : undefined;
    if (dto.product_variant_id != null && !variant) {
      throw new VendixHttpException(ErrorCodes.PRODUCT_VARIANT_MISMATCH);
    }
    if (product.product_variants.length > 0 && !variant) {
      throw new VendixHttpException(
        ErrorCodes.PRODUCT_VARIANT_REQUIRED,
        `El producto "${product.name}" tiene variantes: selecciona una.`,
      );
    }
    const tracksStock =
      product.product_type === 'prepared' ||
      (product.product_type !== 'service' &&
        (variant?.track_inventory_override ?? product.track_inventory) === true);
    if (tracksStock) {
      throw new VendixHttpException(
        ErrorCodes.BOOKING_CHARGE_001,
        `"${product.name}" maneja inventario: véndelo desde el POS`,
      );
    }

    const rows = (await resolveFullTaxRowsByProductId(this.prisma, [product.id])).get(product.id) ?? [];
    const line = resolveCatalogLine({
      catalogUnitPrice: resolveCatalogUnitPrice(product, variant),
      quantity: dto.quantity,
      priceUnitQuantityRaw: product.price_unit_quantity,
      rows: rows as FullTaxRow[],
    });
    const order_id = booking.order_id;

    await this.prisma.$transaction(
      async (tx) => {
        // Inside `$transaction` the client is not store-scoped: name the store.
        const locked: Array<{ id: number }> = await tx.$queryRaw`
          SELECT id FROM orders WHERE id = ${order_id} AND store_id = ${store_id} FOR UPDATE
        `;
        if (!locked.length) {
          throw new VendixHttpException(ErrorCodes.BOOKING_CHARGE_001, 'Esta reserva no tiene orden asociada');
        }
        const order = await tx.orders.findFirst({
          where: { id: order_id, store_id },
          include: {
            payments: { select: { id: true, amount: true, state: true } },
            invoices: { where: { status: { notIn: ['voided', 'cancelled', 'rejected'] } }, select: { id: true } },
            lodging_folio: { select: { id: true } },
          },
        });
        if (
          !order ||
          !(BOOKING_CHARGE_OPEN_STATES as readonly string[]).includes(order.state) ||
          order.invoices.length > 0 ||
          order.lodging_folio
        ) {
          throw new VendixHttpException(
            ErrorCodes.BOOKING_CHARGE_001,
            'La orden de la reserva ya está cerrada o facturada: no admite cargos',
          );
        }
        assertNoActiveFinancialSplit(order);
        const now = new Date();
        await tx.order_items.create({
          data: {
            order_id,
            product_id: product.id,
            product_variant_id: variant?.id ?? null,
            product_name: product.name,
            variant_attributes: variant?.name ?? null,
            description: `Cargo adicional · Reserva ${booking.booking_number}`,
            quantity: dto.quantity,
            unit_price: new Prisma.Decimal(line.unitBase),
            total_price: new Prisma.Decimal(line.totalPrice),
            tax_rate: new Prisma.Decimal(line.taxRate),
            tax_amount_item: new Prisma.Decimal(line.taxAmountItem),
            final_unit_price: new Prisma.Decimal(line.finalUnitPrice),
            price_unit_quantity: line.priceUnitQuantity > 1 ? line.priceUnitQuantity : null,
            item_type: product.product_type === 'service' ? 'service' : 'physical',
            updated_at: now,
            ...(line.taxRows.length > 0
              ? {
                  order_item_taxes: {
                    create: line.taxRows.map(({ row, tax_amount }) => ({
                      tax_rate_id: row.tax_rate_id,
                      tax_name: row.name,
                      tax_rate: Math.round((row.rate + Number.EPSILON) * 100000) / 100000,
                      tax_amount,
                      tax_type: row.tax_type,
                      is_compound: false,
                      is_inclusive: row.is_inclusive,
                    })),
                  },
                }
              : {}),
          },
        });
        // Total, taxes and pending balance from the active lines (shared order rule).
        await this.orderFlow.recalcOrderTotalsFromActiveLinesInTx(tx, order, order_id);
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
  }
}
