import { BadRequestException } from '@nestjs/common';
import { ProductState } from '../dto';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  integerRatio,
  uomRatio,
  validateProductUoms,
  type UomRef,
} from '@common/money-kernel/uom-conversion';
import type { SaleUomRow } from './sale-uoms-sync.util';

/**
 * Reglas de unidades de medida de un producto, compartidas por el editor
 * (`ProductsService`) y las órdenes de compra (`PurchaseOrdersService`): una
 * sola implementación para que ambos rechacen y conviertan igual (S10, S11,
 * S13d de `product-sale-unit-consolidation`).
 *
 * Reciben el cliente Prisma (scoped o `tx`) para que cada llamador corra las
 * lecturas dentro de su propia transacción.
 */

interface UomCatalogRow extends UomRef {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  is_stock_eligible: boolean;
}

/** Cliente mínimo para leer el catálogo de unidades. */
export interface UomCatalogReader {
  units_of_measure: {
    findMany: (args: any) => Promise<any[]>;
    findFirst: (args: any) => Promise<any>;
  };
}

/** Cliente mínimo para los conteos de datos que bloquean un cambio de unidad. */
export interface StockUomDataReader extends UomCatalogReader {
  stock_levels: { count: (args: any) => Promise<number> };
  inventory_cost_layers: { count: (args: any) => Promise<number> };
  inventory_batches: { count: (args: any) => Promise<number> };
  recipe_items: { count: (args: any) => Promise<number> };
}

/** Cliente mínimo para la unicidad del código de balanza. */
export interface ScaleCodeReader {
  products: { findFirst: (args: any) => Promise<any> };
}

/**
 * Deriva `products.purchase_to_stock_factor` desde el catálogo cuando vienen
 * AMBOS `stock_uom_id` y `purchase_uom_id`. El catálogo (no el cliente) es la
 * fuente de verdad del factor; solo el caso "contenido por envase" (compra
 * `count` → stock `mass`/`volume`) acepta el factor manual. Devuelve
 * `undefined` si falta alguno de los dos ids (el llamador no toca el factor).
 */
export async function derivePurchaseToStockFactor(
  prisma: UomCatalogReader,
  stock_uom_id: number | null | undefined,
  purchase_uom_id: number | null | undefined,
  manual_factor?: number | null,
): Promise<number | undefined> {
  if (
    stock_uom_id === undefined ||
    stock_uom_id === null ||
    purchase_uom_id === undefined ||
    purchase_uom_id === null
  ) {
    return undefined;
  }

  const uoms: UomCatalogRow[] = await prisma.units_of_measure.findMany({
    where: { id: { in: [stock_uom_id, purchase_uom_id] } },
  });

  const stockUom = uoms.find((u) => u.id === stock_uom_id);
  const purchaseUom = uoms.find((u) => u.id === purchase_uom_id);

  if (!stockUom || !purchaseUom) {
    throw new VendixHttpException(
      ErrorCodes.PROD_VALIDATE_001,
      'Unidad de medida no encontrada en el catálogo',
      { stock_uom_id, purchase_uom_id },
    );
  }

  // Cross-dimension "contenido por envase": el factor es manual y se respeta
  // sin validar misma-dimensión (no es derivable del catálogo).
  const isCrossDimensionPackaging =
    purchaseUom.dimension === 'count' &&
    (stockUom.dimension === 'mass' || stockUom.dimension === 'volume');
  if (
    manual_factor != null &&
    Number.isInteger(manual_factor) &&
    manual_factor >= 1 &&
    isCrossDimensionPackaging
  ) {
    return manual_factor;
  }

  // Núcleo único (`@common/money-kernel/uom-conversion`): misma dimensión y
  // compra ≥ stock. Una compra menor que el stock (g con stock en kg) daba
  // factor 0 y cada recepción entraba en cero.
  const [violation] = validateProductUoms({
    stock: stockUom,
    principal: null,
    purchase: purchaseUom,
  });
  if (violation?.code === 'PURCHASE_DIMENSION_MISMATCH') {
    throw new BadRequestException(violation.message);
  }
  if (violation) {
    throw new VendixHttpException(
      ErrorCodes.PROD_VALIDATE_001,
      violation.message,
      {
        violation_code: violation.code,
        stock_uom_id,
        purchase_uom_id,
      },
    );
  }

  // Compra de factor no entero (galón → ml) se redondea al recibir.
  return Math.round(uomRatio(purchaseUom, stockUom)!);
}

/**
 * La unidad de STOCK debe ser exacta: el inventario es `Int` en la unidad
 * base, así que una unidad con `factor_to_base` no entero (pulgada, galón)
 * pierde mercancía en cada conversión. El catálogo las marca con
 * `is_stock_eligible=false`.
 */
export async function assertStockUomEligible(
  prisma: UomCatalogReader,
  stock_uom_id: number | null | undefined,
): Promise<void> {
  if (stock_uom_id === undefined || stock_uom_id === null) return;

  const uom = await prisma.units_of_measure.findFirst({
    where: { id: stock_uom_id },
    select: { code: true, name: true, is_stock_eligible: true, is_active: true },
  });
  if (!uom || !uom.is_active) {
    throw new VendixHttpException(
      ErrorCodes.PROD_VALIDATE_001,
      'Unidad de medida no encontrada en el catálogo',
      { stock_uom_id },
    );
  }
  if (!uom.is_stock_eligible) {
    throw new VendixHttpException(
      ErrorCodes.PROD_UOM_NOT_STOCK_ELIGIBLE,
      `${uom.name} (${uom.code}) no puede ser la unidad de stock porque su factor de conversión no es entero. Úsala como unidad de compra o define el stock en una unidad exacta.`,
      { stock_uom_id, code: uom.code },
    );
  }
}

/**
 * QUI-978 — valida las UoMs de venta contra el catálogo y el stock (existen,
 * activas, una sola principal, sin duplicados) y aplica las reglas del núcleo
 * (misma dimensión, enteras sobre el stock, stock en la base si la principal
 * es medible, `pricing_type` acorde a la principal).
 *
 * Devuelve la escala de precio que impone la principal
 * (`principal.factor_to_base / stock.factor_to_base`) o `null` si no hay filas.
 */
export async function assertSaleUomsValid(
  prisma: UomCatalogReader,
  sale_uoms: SaleUomRow[] | null | undefined,
  stock_uom_id: number | null | undefined,
  pricing_type?: string | null,
): Promise<number | null> {
  if (!sale_uoms || sale_uoms.length === 0) return null;

  if (stock_uom_id === undefined || stock_uom_id === null) {
    throw new VendixHttpException(
      ErrorCodes.PROD_VALIDATE_001,
      'Para declarar unidades de venta el producto debe tener unidad de stock',
      { sale_uoms },
    );
  }

  const uomIds = sale_uoms.map((row) => row.uom_id);
  if (new Set(uomIds).size !== uomIds.length) {
    throw new VendixHttpException(
      ErrorCodes.PROD_VALIDATE_001,
      'Las unidades de venta no pueden repetirse',
      { uom_ids: uomIds },
    );
  }

  const principals = sale_uoms.filter((row) => row.is_principal === true);
  if (principals.length !== 1) {
    throw new VendixHttpException(
      ErrorCodes.PROD_VALIDATE_001,
      'Debe haber exactamente una unidad de venta principal',
      { principals: principals.length },
    );
  }

  const uoms: UomCatalogRow[] = await prisma.units_of_measure.findMany({
    where: { id: { in: [stock_uom_id, ...uomIds] } },
  });

  const stockUom = uoms.find((u) => u.id === stock_uom_id);
  if (!stockUom || !stockUom.is_active) {
    throw new VendixHttpException(
      ErrorCodes.PROD_VALIDATE_001,
      'Unidad de medida no encontrada en el catálogo',
      { stock_uom_id },
    );
  }

  for (const uom_id of uomIds) {
    const uom = uoms.find((u) => u.id === uom_id);
    if (!uom || !uom.is_active) {
      throw new VendixHttpException(
        ErrorCodes.PROD_VALIDATE_001,
        'Unidad de medida no encontrada en el catálogo',
        { uom_id },
      );
    }
  }

  const principalUom = uoms.find((u) => u.id === principals[0].uom_id)!;
  const additional = sale_uoms
    .filter((row) => row.is_principal !== true)
    .map((row) => uoms.find((u) => u.id === row.uom_id)!);
  const [violation] = validateProductUoms({
    stock: stockUom,
    principal: principalUom,
    additional,
    pricing_type: pricing_type ?? null,
  });
  if (violation) {
    throw new VendixHttpException(ErrorCodes.PROD_VALIDATE_001, violation.message, {
      violation_code: violation.code,
      uom_code: violation.uom_code,
      stock_uom_id,
    });
  }

  return integerRatio(principalUom, stockUom)!;
}

/**
 * Cambiar la unidad de stock de un producto que YA opera: existencias, capas
 * de costo, lotes y recetas están escritos en la unidad vieja. Sin datos no
 * hay nada que convertir (devuelve `null`). Con datos exige
 * `stock_uom_conversion: 'convert'` (si no, `PROD_UOM_CONVERSION_REQUIRED`
 * con el conteo de lo que bloquea) y devuelve la conversión pendiente para que
 * el llamador la ejecute con `StockLevelManager.convertStockUom` dentro de su
 * transacción.
 */
export async function resolveStockUomChange(
  prisma: StockUomDataReader,
  params: {
    product_id: number;
    existing_stock_uom_id: number | null | undefined;
    new_stock_uom_id: number | null | undefined;
    stock_uom_conversion?: string | null;
  },
): Promise<{ from: number; to: number } | null> {
  const { product_id: id, existing_stock_uom_id, new_stock_uom_id } = params;
  const stockUomChanged =
    new_stock_uom_id !== undefined &&
    existing_stock_uom_id != null &&
    Number(new_stock_uom_id) !== Number(existing_stock_uom_id);
  if (!stockUomChanged) return null;

  const [levels, layers, batches, recipeLines] = await Promise.all([
    prisma.stock_levels.count({
      where: { product_id: id, NOT: { quantity_on_hand: 0 } },
    }),
    prisma.inventory_cost_layers.count({
      where: { product_id: id, NOT: { quantity_remaining: 0 } },
    }),
    prisma.inventory_batches.count({
      where: { product_id: id, NOT: { quantity: 0 } },
    }),
    prisma.recipe_items.count({
      where: { component_product_id: id },
    }),
  ]);
  const hasData = levels + layers + batches + recipeLines > 0;
  if (!hasData) return null;

  if (params.stock_uom_conversion !== 'convert') {
    // S9 — el editor arma la confirmación "Convertir existencias" con estos
    // datos; el mensaje no expone el contrato JSON.
    const units: UomCatalogRow[] = await prisma.units_of_measure.findMany({
      where: {
        id: {
          in: [Number(existing_stock_uom_id), Number(new_stock_uom_id)],
        },
      },
    });
    const fromUom = units.find((u) => u.id === Number(existing_stock_uom_id));
    const toUom = units.find((u) => u.id === Number(new_stock_uom_id));
    const factor = fromUom && toUom ? uomRatio(fromUom, toUom) : null;
    throw new VendixHttpException(
      ErrorCodes.PROD_UOM_CONVERSION_REQUIRED,
      `El producto ya tiene inventario contado en ${fromUom?.code ?? 'su unidad actual'}. Confirma la conversión a ${toUom?.code ?? 'la nueva unidad'} para guardar, o deja la unidad como está.`,
      {
        from_uom_code: fromUom?.code ?? null,
        from_uom_name: fromUom?.name ?? null,
        to_uom_code: toUom?.code ?? null,
        to_uom_name: toUom?.name ?? null,
        factor: factor != null ? Number(factor.toFixed(9)) : null,
        stock_levels: levels,
        cost_layers: layers,
        batches,
        recipe_items: recipeLines,
      },
    );
  }
  return {
    from: Number(existing_stock_uom_id),
    to: Number(new_stock_uom_id),
  };
}

/**
 * Unicidad por tienda del código de balanza (PLU) entre productos NO
 * archivados. `null` / `undefined` no se restringen.
 */
export async function assertScaleCodeUnique(
  prisma: ScaleCodeReader,
  scaleCode: number | null | undefined,
  options: { excludeProductId?: number } = {},
): Promise<void> {
  if (scaleCode === null || scaleCode === undefined) return;

  const conflict = await prisma.products.findFirst({
    where: {
      scale_code: scaleCode,
      state: { not: ProductState.ARCHIVED },
      ...(options.excludeProductId && {
        NOT: { id: options.excludeProductId },
      }),
    },
    select: { id: true, name: true },
  });
  if (conflict) {
    throw new VendixHttpException(
      ErrorCodes.PROD_SCALE_CODE_DUP_001,
      `El código de balanza ${scaleCode} ya está en uso por el producto "${conflict.name}"`,
      {
        scale_code: scaleCode,
        product_id: conflict.id,
        product_name: conflict.name,
      },
    );
  }
}
