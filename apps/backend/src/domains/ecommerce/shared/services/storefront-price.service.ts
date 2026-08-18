import { Injectable } from '@nestjs/common';
import {
  PriceResolverService,
  PriceResolutionResult,
} from '../../../store/products/services/price-resolver.service';
import {
  resolvePackSize,
  resolveStockUnitsConsumed,
} from '../../../store/products/services/packaging.util';
import type { DefaultSaleUnit } from '../../../store/products/services/default-sale-unit.util';

/**
 * Producto tal como lo leen las tres superficies del storefront. Es
 * deliberadamente laxo (`any` en las relaciones) porque cada caller trae su
 * propio `include` de Prisma: catálogo trae imágenes y stock_levels, el carrito
 * trae solo impuestos. Lo ÚNICO que este servicio exige son los campos de
 * precio y la relación de impuestos.
 */
export interface StorefrontLineProduct {
  base_price: unknown;
  is_on_sale: boolean;
  sale_price?: unknown;
  track_inventory: boolean;
  product_tax_assignments?: any[];
}

export interface StorefrontLineVariant {
  id?: number | null;
  price_override?: unknown;
  is_on_sale?: boolean;
  sale_price?: unknown;
  track_inventory_override?: boolean | null;
}

export interface StorefrontLineInput {
  product: StorefrontLineProduct;
  variant?: StorefrontLineVariant | null;
  /**
   * Presentación ya RESUELTA y AUTORIZADA por el caller. `null` = cascada
   * legacy (unidad principal). Este servicio NO lee la base de datos a
   * propósito: quién puede vender en qué presentación es una decisión del
   * caller (hoy siempre la default; mañana, la que elija el cliente), y
   * mezclarla acá volvería intestable la aritmética del dinero.
   */
  saleUnit?: DefaultSaleUnit | null;
  /**
   * Cuenta PAQUETES, no unidades de stock. Solo se usa para derivar
   * `stock_units_consumed`; NUNCA multiplica dinero.
   */
  quantity?: number;
  /**
   * Omitir → 0 → `gross_unit_price === net_unit_price`. Es exactamente lo que
   * necesita el checkout, que persiste el NETO y arma el impuesto aparte.
   */
  taxRate?: number;
}

/**
 * Precio resuelto de UNA línea del storefront.
 *
 * REGLA DE DINERO: `net_unit_price` / `gross_unit_price` son el precio del
 * PAQUETE ENTERO cuando hay presentación. `quantity` cuenta PAQUETES, así que
 * `total = precio_paquete × quantity`. `pack_size` NO multiplica dinero jamás;
 * solo sirve para stock y unidades consumidas.
 *
 * Se devuelven AMBAS escalas —neta y bruta— a propósito. Catálogo y carrito
 * publican CON impuesto; el checkout persiste el NETO y calcula el impuesto por
 * su propio camino (`taxes_service.calculateProductTaxes`). Un helper que
 * devolviera un solo número obligaría a uno de los dos a convertir, y esa
 * conversión silenciosa es justamente la que hoy hace que la vitrina, el
 * carrito y el cobro muestren tres cifras distintas.
 */
export interface StorefrontLinePrice {
  /** Precio NETO del paquete completo (sin impuesto). Sin redondear. */
  net_unit_price: number;
  /** `net_unit_price * (1 + tax_rate)`, redondeado a centavos. */
  gross_unit_price: number;
  /**
   * Precio tachado, en la MISMA escala NETA que `net_unit_price`. `null`
   * cuando no hay nada que tachar. Quien lo muestre debe aplicarle `tax_rate`,
   * igual que hace el resolver para `gross_unit_price`.
   */
  compare_at_price: number | null;
  /** Suma de tasas del producto, en decimal (0.19 = 19%). */
  tax_rate: number;
  applied_price_tier_id: number | null;
  applied_price_tier_name: string | null;
  /** Unidades de stock por paquete. `1` cuando no hay empaque. */
  pack_size: number;
  /**
   * Unidades de stock que consume la línea (`quantity × pack_size`). `null`
   * cuando `pack_size === 1` o cuando el caller no pasó `quantity`: ese `null`
   * es la señal de "no hubo desdoblamiento paquete↔unidad", y es lo que
   * persisten las órdenes.
   */
  stock_units_consumed: number | null;
  source: string;
}

/**
 * StorefrontPriceService
 *
 * Único punto donde vitrina, carrito y checkout resuelven el precio de una
 * línea. Existe porque las tres superficies tenían su propia copia de la
 * cascada: el catálogo ya era consciente de la presentación por defecto
 * (mostraba el precio del bulto) mientras el carrito seguía llamando a
 * `resolvePrice` a secas (mostraba el precio de la unidad) y el checkout
 * volvía a resolver con tarifa (cobraba el bulto). Tres lecturas del mismo
 * producto, tres cifras.
 *
 * Es SÍNCRONO y SIN acceso a base de datos por diseño: la lectura de la
 * presentación la hace el caller (en lote, para no volver N+1 el listado), y
 * así esta aritmética —la que decide cuánta plata se cobra— se puede probar
 * sin un solo mock de Prisma.
 */
@Injectable()
export class StorefrontPriceService {
  constructor(private readonly priceResolver: PriceResolverService) {}

  resolveLine(input: StorefrontLineInput): StorefrontLinePrice {
    const { product, variant, saleUnit, quantity } = input;
    const taxRate = this.normalizeRate(input.taxRate);

    const resolverProduct = {
      base_price: this.toNumber(product?.base_price),
      is_on_sale: !!product?.is_on_sale,
      sale_price: this.toNullableNumber(product?.sale_price),
      track_inventory: !!product?.track_inventory,
    };
    const resolverVariant = variant
      ? {
          id: variant.id != null ? Number(variant.id) : undefined,
          price_override: this.toNullableNumber(variant.price_override),
          is_on_sale: !!variant.is_on_sale,
          sale_price: this.toNullableNumber(variant.sale_price),
          track_inventory_override: variant.track_inventory_override ?? null,
        }
      : undefined;

    let result: PriceResolutionResult;
    if (saleUnit) {
      // `resolveWithTier` exige `has_multiple_price_tiers` para activar la
      // tarifa. Se fuerza en `true` porque la presentación que llega acá ya fue
      // autorizada por el caller: depender del flag denormalizado del producto
      // deja el precio a merced de una sincronización que puede quedar vieja, y
      // el modo de fallo es cobrar el precio equivocado.
      result = this.priceResolver.resolveWithTier({
        product: { ...resolverProduct, has_multiple_price_tiers: true },
        variant: resolverVariant,
        priceTier: saleUnit.tier,
        tierOverrides: saleUnit.overrides,
        taxRate,
      });
    } else {
      result = this.priceResolver.resolvePrice(
        { product: resolverProduct, variant: resolverVariant },
        taxRate,
      );
    }

    // El packSize se toma del RESULTADO del resolver, no de una segunda lectura
    // de la cascada `override ?? tier ?? 1`: el resolver ya eligió la fila de
    // override (la de la variante si existe, si no la base) para calcular el
    // precio, y recalcularlo aparte abriría la puerta a que el dinero y el
    // stock elijan filas distintas. `resolvePackSize` se sigue usando para que
    // la regla "todo lo que no sea > 1 colapsa a 1" viva en un solo lugar.
    const packSize = resolvePackSize(result.unitsPerPackage ?? null);
    const stockUnitsConsumed =
      quantity != null && Number.isFinite(Number(quantity))
        ? resolveStockUnitsConsumed(Number(quantity), packSize)
        : null;

    return {
      net_unit_price: result.unitPrice,
      gross_unit_price: this.roundMoney(result.unitPriceWithTax),
      compare_at_price: result.compareAtPrice,
      tax_rate: taxRate,
      applied_price_tier_id: result.appliedPriceTierId ?? null,
      applied_price_tier_name: result.appliedPriceTierName ?? null,
      pack_size: packSize,
      stock_units_consumed: stockUnitsConsumed,
      source: result.source,
    };
  }

  /**
   * Suma de tasas de impuesto del producto. Las tasas se guardan en decimal
   * (0.19 = 19%).
   *
   * Vive acá para que catálogo y carrito dejen de mantener dos copias idénticas
   * de este recorrido: cuando las copias divergen, la vitrina y el carrito
   * publican bases gravables distintas del mismo producto.
   */
  getTotalTaxRate(product: any): number {
    let totalTaxRate = 0;
    if (product?.product_tax_assignments) {
      for (const assignment of product.product_tax_assignments) {
        if (assignment?.tax_categories?.tax_rates) {
          for (const tax of assignment.tax_categories.tax_rates) {
            totalTaxRate += Number(tax.rate);
          }
        }
      }
    }
    return totalTaxRate;
  }

  /**
   * Unidades de stock que ocupa 1 paquete de esta presentación, para el caller
   * que necesita convertir stock↔paquetes sin resolver el precio (la vitrina
   * decidiendo si el producto está agotado, por ejemplo).
   *
   * Elige la fila base de overrides (`variant_id = null`) porque quien
   * pregunta por el producto no está mirando una variante: un producto
   * publicado en presentación no expone variantes en el storefront.
   */
  resolvePackSizeForSaleUnit(saleUnit?: DefaultSaleUnit | null): number {
    if (!saleUnit) return 1;
    const baseOverride = (saleUnit.overrides ?? []).find(
      (o) => o.variant_id == null,
    );
    return resolvePackSize(
      saleUnit.tier.units_per_package,
      baseOverride?.override_units_per_package,
    );
  }

  private normalizeRate(rate?: number): number {
    const n = Number(rate ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  private toNumber(value: unknown): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  private toNullableNumber(value: unknown): number | null {
    if (value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
