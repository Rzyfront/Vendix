import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { product_variants, products } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { BlockQuote, quoteBlocks } from '../../../../common/utils/rate-window.util';
import { resolveStoreTimezone } from '../../../../common/utils/store-timezone.util';
import { ShippingTaxService } from '../../shipping/services/shipping-tax.service';
import type { FullTaxRow } from '../../orders/utils/catalog-line-pricing.util';
import { buildSessionTaxedLine } from '../../service-sessions/utils/session-order-lines.util';

export interface RentalQuote {
  amount: number;
  cents: number;
  blocks: number;
  block_minutes: number | null;
  per_block: Array<{ start_at: Date; amount: number; cents: number; window_id: number | null }>;
  pricing_mode: 'fixed_price' | 'station_rate';
  /**
   * Price of the blocks before the station's rental tax. For `station_rate`, `amount`/`cents` are the
   * GROSS of the line built with the station's tax rows (same rule as POS): exclusive tax is added on
   * top, inclusive tax is already inside. Equal to `amount` without a rental tax or for `fixed_price`.
   */
  published_amount: number;
  /** Station rental tax rows (`station_rate` only; null for `fixed_price`, whose tax is the product's). */
  tax_rows: FullTaxRow[] | null;
}

const STATION_RATE_MESSAGE = 'La duración debe ser un múltiplo del bloque de tarifa de la estación.';

@Injectable()
export class RentalQuoteService {
  constructor(
    private readonly prisma: StorePrismaService,
    // Optional so a spec or module without it prices with no rental tax, as before.
    @Optional() private readonly shippingTax?: ShippingTaxService,
  ) {}

  private get storeId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new BadRequestException('No se encontró contexto de tienda');
    return store_id;
  }

  private perBlock(list: BlockQuote[]): RentalQuote['per_block'] {
    return list.map((b) => ({ start_at: b.startAt, amount: b.cents / 100, cents: b.cents, window_id: b.windowId }));
  }

  /** Catalog price of the variant/product, same precedence as the POS resolver (sale, override, base). */
  private catalogPrice(
    product: Pick<products, 'is_on_sale' | 'sale_price' | 'base_price'>,
    variant?: Pick<product_variants, 'is_on_sale' | 'sale_price' | 'price_override'> | null,
  ): number {
    if (variant?.is_on_sale && variant.sale_price != null && Number(variant.sale_price) > 0) return Number(variant.sale_price);
    if (variant?.price_override != null && Number(variant.price_override) > 0) return Number(variant.price_override);
    if (product.is_on_sale && product.sale_price != null && Number(product.sale_price) > 0) return Number(product.sale_price);
    return Number(product.base_price || 0);
  }

  private async loadStation(stationId: number) {
    const station = await this.prisma.service_stations.findFirst({
      where: { id: stationId, store_id: this.storeId },
      select: {
        id: true,
        rental_block_minutes: true,
        rental_block_price: true,
        rental_tax_category_id: true,
        rental_tax_is_inclusive: true,
      },
    });
    if (!station) throw new NotFoundException('Estación no encontrada');
    return station;
  }

  private loadWindows(stationId: number) {
    return this.prisma.service_station_rate_windows.findMany({
      where: { store_id: this.storeId, station_id: stationId, is_active: true },
      orderBy: [{ weekday: 'asc' }, { block_order: 'asc' }],
    });
  }

  /**
   * `minutes`: the booked duration when there is one. It wins over the catalog duration
   * because a free-duration station books any multiple of the block (S1).
   */
  async quote(input: { productId: number; variantId?: number | null; stationId: number; startAt: Date; minutes?: number | null }): Promise<RentalQuote> {
    const product = await this.prisma.products.findFirst({
      where: { id: input.productId, store_id: this.storeId },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    let variant: product_variants | null = null;
    if (input.variantId) {
      variant = await this.prisma.product_variants.findFirst({
        where: { id: input.variantId, product_id: product.id },
      });
      if (!variant) throw new NotFoundException('Variante no encontrada');
    }
    const minutes: number | null = input.minutes ?? variant?.service_duration_minutes ?? product.service_duration_minutes ?? null;

    if (product.rental_pricing_mode !== 'station_rate') {
      // fixed_price (A15): the catalog price is the rental; windows never apply.
      const cents = Math.round(this.catalogPrice(product, variant) * 100);
      return {
        amount: cents / 100,
        cents,
        blocks: 1,
        block_minutes: minutes,
        per_block: [],
        pricing_mode: 'fixed_price',
        published_amount: cents / 100,
        tax_rows: null,
      };
    }

    const station = await this.loadStation(input.stationId);
    const blockMinutes = station.rental_block_minutes;
    if (!blockMinutes || station.rental_block_price == null) {
      throw new VendixHttpException(ErrorCodes.STATION_009, 'La estación no tiene tarifa por tiempo configurada.');
    }
    if (!minutes || minutes <= 0 || minutes % blockMinutes !== 0) {
      throw new VendixHttpException(ErrorCodes.STATION_009, STATION_RATE_MESSAGE);
    }
    const result = await this.priceStation(station, input.startAt, minutes / blockMinutes);
    // The tax of a station rental is the station's in every channel (POS rule): the amount quoted,
    // shown and charged is the gross of that line.
    const taxRows = this.shippingTax
      ? await this.shippingTax.taxRowsForCategory(null, {
          tax_category_id: station.rental_tax_category_id ?? null,
          tax_is_inclusive: station.rental_tax_is_inclusive ?? true,
          store_id: this.storeId,
        })
      : [];
    const gross = taxRows.length
      ? buildSessionTaxedLine(result.cents / 100, 1, taxRows).final_unit_price
      : null;
    const grossCents = gross ? Math.round(gross.toNumber() * 100) : result.cents;
    return {
      amount: grossCents / 100,
      cents: grossCents,
      blocks: minutes / blockMinutes,
      block_minutes: blockMinutes,
      per_block: this.perBlock(result.perBlock),
      pricing_mode: 'station_rate',
      published_amount: result.cents / 100,
      tax_rows: taxRows,
    };
  }

  /** Station time rate plus windows, no product (extensions). */
  async quoteStationBlocks(input: { stationId: number; startAt: Date; blocks: number }) {
    const station = await this.loadStation(input.stationId);
    if (!station.rental_block_minutes || station.rental_block_price == null) {
      throw new VendixHttpException(ErrorCodes.STATION_009, 'La estación no tiene tarifa por tiempo configurada.');
    }
    const result = await this.priceStation(station, input.startAt, input.blocks);
    return {
      amount: result.cents / 100,
      cents: result.cents,
      blocks: input.blocks,
      block_minutes: station.rental_block_minutes,
      per_block: this.perBlock(result.perBlock),
    };
  }

  private async priceStation(
    station: { id: number; rental_block_minutes: number | null; rental_block_price: unknown },
    startAt: Date,
    blocks: number,
  ) {
    const [windows, tz] = await Promise.all([
      this.loadWindows(station.id),
      resolveStoreTimezone(this.prisma, this.storeId),
    ]);
    return quoteBlocks({
      startAt,
      blockMinutes: station.rental_block_minutes as number,
      blocks,
      windows,
      basePrice: Number(station.rental_block_price),
      tz,
    });
  }
}
