import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  UomService,
  UnitOfMeasure,
} from '../../inventory/services/uom.service';
import { PriceTier } from '../../price-tiers/interfaces';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import {
  buildSaleConfigExplanation,
  SaleConfigExplanation,
} from '../../../../../shared/services/pricing/sale-config-explainer.util';
import { PosProductService, Product } from './pos-product.service';
import { resolvePriceUnitQuantity } from '../utils/line-units.util';

/**
 * Cómo se mide y cómo se captura un producto en el POS — QUI-648.
 *
 * Un producto se mide de UNA sola manera: por pieza, por variantes o por
 * presentaciones. Cuando declara unidad de stock, el inventario vive en la
 * unidad MÍNIMA de su dimensión (mm, g, ml) y el precio se publica por N de
 * esas unidades (`price_unit_quantity`, la *price unit* de SAP).
 *
 * El cajero nunca ve la unidad mínima: pide "3 metros" o pesa 2,35 kg. Este
 * servicio resuelve en qué unidad se captura y por cuánto hay que multiplicar
 * para llegar a la unidad mínima, que es la que viaja en `order_items.quantity`.
 */
export interface PosSaleUnitConfig {
  /** Unidad mínima en la que vive el stock. `null` = el producto va por pieza. */
  stockUnit: {
    id: number;
    code: string;
    name: string;
    dimension: string;
    factorToBase: number;
  } | null;
  /** Unidades de stock que cubre el precio publicado. `1` = precio por unidad. */
  priceUnitQuantity: number;
  /** Unidad en la que el cajero captura ("m", "kg"). `null` = piezas. */
  captureUnit: { code: string; name: string } | null;
  /** Unidades mínimas que consume UNA unidad de captura. `1` = sin conversión. */
  unitsPerCapture: number;
}

/** Producto por pieza: el comportamiento histórico, sin conversión alguna. */
export const PIECE_SALE_UNIT: PosSaleUnitConfig = {
  stockUnit: null,
  priceUnitQuantity: 1,
  captureUnit: null,
  unitsPerCapture: 1,
};

/** Campos del contrato de venta que el POS lee de un producto. */
interface SaleUnitFields {
  stock_uom_id?: number | null;
  price_unit_quantity?: number | null;
  sale_config_summary?: SaleConfigExplanation | null;
}

@Injectable({ providedIn: 'root' })
export class PosSaleUnitService {
  private readonly uomService = inject(UomService);
  private readonly productService = inject(PosProductService);
  private readonly currencyFormat = inject(CurrencyFormatService);

  /** Catálogo global de unidades. Se carga una vez y se comparte con inventario. */
  readonly catalog = signal<UnitOfMeasure[]>([]);

  private catalogPromise: Promise<UnitOfMeasure[]> | null = null;
  /**
   * Campos del contrato traídos del detalle del producto cuando el listado no
   * los trae. Una sola consulta por producto y por sesión de POS.
   */
  private readonly hydrated = new Map<string, SaleUnitFields>();
  private readonly hydrating = new Map<string, Promise<void>>();

  /**
   * Configuración SÍNCRONA a partir de lo que el producto ya trae. No hace red:
   * si el payload no declara unidad de stock, el producto se comporta como
   * siempre (por pieza) y el POS no cambia una coma de su flujo.
   */
  configFor(product: Product | null | undefined): PosSaleUnitConfig {
    if (!product) return PIECE_SALE_UNIT;
    const fields = this.fieldsFor(product);
    const scale = resolvePriceUnitQuantity(fields.price_unit_quantity);
    const stockUomId = Number(fields.stock_uom_id ?? 0);

    if (!Number.isFinite(stockUomId) || stockUomId <= 0) {
      return { ...PIECE_SALE_UNIT, priceUnitQuantity: scale };
    }

    const catalog = this.catalog();
    if (catalog.length === 0) {
      // El catálogo aún no llegó: no se inventa una conversión. Se dispara la
      // carga para que el siguiente producto medido ya la encuentre.
      void this.ensureCatalog();
      return { ...PIECE_SALE_UNIT, priceUnitQuantity: scale };
    }

    const stock = catalog.find((unit) => Number(unit.id) === stockUomId);
    if (!stock) return { ...PIECE_SALE_UNIT, priceUnitQuantity: scale };

    const stockFactor = Number(stock.factor_to_base ?? 1) || 1;
    const stockUnit = {
      id: Number(stock.id),
      code: stock.code,
      name: stock.name,
      dimension: String(stock.dimension),
      factorToBase: stockFactor,
    };

    // La unidad de captura es la que cubre exactamente la escala del precio:
    // stock en mm + precio por 1000 mm ⇒ el cajero pide metros. Si el catálogo
    // no tiene esa unidad, se captura en la unidad de stock (nunca se redondea
    // una equivalencia que no existe).
    const targetFactor = stockFactor * scale;
    const capture =
      scale > 1
        ? catalog.find(
            (unit) =>
              unit.dimension === stock.dimension &&
              Number(unit.factor_to_base) === targetFactor,
          )
        : stock;

    if (!capture) {
      return {
        stockUnit,
        priceUnitQuantity: scale,
        captureUnit: { code: stock.code, name: stock.name },
        unitsPerCapture: 1,
      };
    }

    return {
      stockUnit,
      priceUnitQuantity: scale,
      captureUnit: { code: capture.code, name: capture.name },
      unitsPerCapture: Math.max(
        1,
        Math.round((Number(capture.factor_to_base) || 1) / stockFactor),
      ),
    };
  }

  /**
   * Igual que `configFor`, pero completando el contrato desde el detalle del
   * producto cuando el listado no lo trajo. Solo se usa en caminos que YA
   * esperan al cajero (captura de peso, pistoleo): un `tap` para agregar una
   * unidad nunca paga esta consulta.
   */
  async resolveFor(product: Product | null | undefined): Promise<PosSaleUnitConfig> {
    if (!product) return PIECE_SALE_UNIT;
    await this.ensureCatalog();
    if (this.needsHydration(product)) {
      await this.hydrate(product);
    }
    return this.configFor(product);
  }

  /**
   * La frase que explica cómo se vende el producto. Prefiere la que arma el
   * backend con el mismo helper (`sale_config_summary`); si no llegó, la
   * construye acá con `buildSaleConfigExplanation` para que el POS, el editor
   * de producto y la compra digan exactamente lo mismo.
   */
  explain(
    product: Product | null | undefined,
    tiers: PriceTier[] = [],
  ): SaleConfigExplanation | null {
    if (!product) return null;
    const fields = this.fieldsFor(product);
    if (fields.sale_config_summary) return fields.sale_config_summary;

    const config = this.configFor(product);
    const presentations = tiers
      .filter((tier) => Number(tier.units_per_package ?? 0) > 1)
      .map((tier) => ({
        name: tier.name,
        packSize: Number(tier.units_per_package),
      }));

    if (
      !config.stockUnit &&
      presentations.length === 0 &&
      product.has_variants !== true
    ) {
      return null;
    }

    return buildSaleConfigExplanation({
      stockUnit: config.stockUnit
        ? { code: config.stockUnit.code, name: config.stockUnit.name }
        : null,
      priceUnitQuantity: config.priceUnitQuantity,
      basePrice: Number(product.price ?? 0) || null,
      presentations,
      catalog: this.catalog().map((unit) => ({
        code: unit.code,
        name: unit.name,
        dimension: unit.dimension,
        factorToBase: Number(unit.factor_to_base) || 1,
      })),
      dimension: config.stockUnit?.dimension ?? null,
      formatMoney: (value: number) => this.currencyFormat.format(value),
      hasVariants: product.has_variants === true,
    });
  }

  /** Catálogo de unidades; idempotente y compartido con el módulo de inventario. */
  ensureCatalog(): Promise<UnitOfMeasure[]> {
    if (!this.catalogPromise) {
      this.catalogPromise = firstValueFrom(this.uomService.getCatalog())
        .then((response) => {
          const units = response?.data ?? [];
          this.catalog.set(units);
          return units;
        })
        .catch(() => {
          // Sin catálogo el POS sigue vendiendo por pieza; se reintenta luego.
          this.catalogPromise = null;
          return [] as UnitOfMeasure[];
        });
    }
    return this.catalogPromise;
  }

  /** Campos del contrato: los del payload, completados con los hidratados. */
  private fieldsFor(product: Product): SaleUnitFields {
    const raw = product as Product & SaleUnitFields;
    const cached = this.hydrated.get(String(product.id));
    return {
      stock_uom_id: raw.stock_uom_id ?? cached?.stock_uom_id ?? null,
      price_unit_quantity:
        raw.price_unit_quantity ?? cached?.price_unit_quantity ?? 1,
      sale_config_summary:
        raw.sale_config_summary ?? cached?.sale_config_summary ?? null,
    };
  }

  /**
   * `true` cuando el payload NO declara el contrato (ni `stock_uom_id` ni
   * `price_unit_quantity`) y todavía no se hidrató. `null` explícito significa
   * "por pieza" y no dispara consulta alguna.
   */
  private needsHydration(product: Product): boolean {
    const raw = product as Product & SaleUnitFields;
    if (raw.stock_uom_id !== undefined || raw.price_unit_quantity !== undefined) {
      return false;
    }
    return !this.hydrated.has(String(product.id));
  }

  private hydrate(product: Product): Promise<void> {
    const key = String(product.id);
    const pending = this.hydrating.get(key);
    if (pending) return pending;

    const request = firstValueFrom(this.productService.getProductById(key))
      .then((detail: any) => {
        const data = detail?.data ?? detail;
        if (!data) {
          this.hydrated.set(key, {});
          return;
        }
        this.hydrated.set(key, {
          stock_uom_id: data.stock_uom_id ?? null,
          price_unit_quantity: data.price_unit_quantity ?? 1,
          sale_config_summary: data.sale_config_summary ?? null,
        });
      })
      .catch(() => {
        // Un detalle caído no puede bloquear una venta: el producto se trata
        // por pieza, que es como se comportaba antes de esta feature.
        this.hydrated.set(key, {});
      })
      .finally(() => {
        this.hydrating.delete(key);
      });

    this.hydrating.set(key, request);
    return request;
  }
}
