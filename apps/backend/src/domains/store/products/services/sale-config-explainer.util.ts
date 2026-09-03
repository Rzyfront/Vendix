/**
 * Espejo backend de `sale-config-explainer.util.ts` del frontend.
 *
 * La misma frase la necesitan el editor web, el modal de compra, el POS y —vía
 * API— el móvil y Vexi. Tenerla en un solo lugar por lado (uno en cada app,
 * con el mismo contrato) es lo que impide que dos superficies describan al
 * mismo producto de dos maneras distintas.
 *
 * Funciones puras: sin DI, sin Prisma. Quien la llama resuelve los datos.
 */

export interface SaleConfigUnit {
  code: string;
  name: string;
  factor_to_base?: number | null;
  dimension?: string | null;
}

export interface SaleConfigPresentation {
  name: string;
  packSize: number;
  price?: number | null;
}

export interface SaleConfigInput {
  stockUnit?: SaleConfigUnit | null;
  priceUnitQuantity?: number | null;
  basePrice?: number | null;
  presentations?: SaleConfigPresentation[];
  /** Catálogo de unidades de la misma dimensión, para traducir cantidades. */
  catalog?: SaleConfigUnit[];
  hasVariants?: boolean;
}

export interface SaleConfigExplanation {
  headline: string;
  lines: string[];
}

const money = (value: number): string =>
  `$${Math.round(value).toLocaleString('es-CO')}`;

const num = (value: number): string => value.toLocaleString('es-CO');

/**
 * 20000 mm → "20 m". Devuelve `null` si no hay equivalencia entera: redondear
 * acá convertiría una explicación en una mentira.
 */
export function describeStockQuantity(
  quantity: number,
  stockUnit: SaleConfigUnit,
  catalog: SaleConfigUnit[] = [],
): string | null {
  const sf = Number(stockUnit.factor_to_base ?? 1);
  if (!Number.isFinite(sf) || sf <= 0) return null;
  const best = catalog
    .filter(
      (u) =>
        (!stockUnit.dimension || u.dimension === stockUnit.dimension) &&
        Number(u.factor_to_base ?? 0) > sf,
    )
    .map((u) => ({ unit: u, value: (quantity * sf) / Number(u.factor_to_base) }))
    .filter(({ value }) => value >= 1 && Number.isInteger(value))
    .sort((a, b) => a.value - b.value)[0];
  return best ? `${num(best.value)} ${best.unit.code}` : null;
}

export function buildSaleConfigExplanation(
  input: SaleConfigInput,
): SaleConfigExplanation {
  const stock = input.stockUnit ?? null;
  const scale = Number(input.priceUnitQuantity ?? 1) || 1;
  const presentations = (input.presentations ?? []).filter(
    (p) => Number(p.packSize) > 1,
  );
  const catalog = input.catalog ?? [];
  const lines: string[] = [];

  if (input.hasVariants) {
    return {
      headline: 'Este producto se mide por variantes.',
      lines: [
        'Cada variante lleva su propio inventario y su propio precio.',
        'Un producto con variantes no usa presentaciones de venta.',
      ],
    };
  }

  if (!stock) {
    if (input.basePrice != null && Number(input.basePrice) > 0) {
      lines.push(`Cada unidad cuesta ${money(Number(input.basePrice))}.`);
    }
    for (const p of presentations) {
      lines.push(
        p.price != null
          ? `${p.name}: ${money(Number(p.price))} y descuenta ${num(Number(p.packSize))} unidades.`
          : `${p.name} descuenta ${num(Number(p.packSize))} unidades.`,
      );
    }
    return { headline: 'Este producto se vende por pieza.', lines };
  }

  const headline = `El stock se cuenta en ${stock.name.toLowerCase()} (${stock.code}).`;

  if (input.basePrice != null && Number(input.basePrice) > 0) {
    if (scale > 1) {
      const readable = describeStockQuantity(scale, stock, catalog);
      lines.push(
        readable
          ? `Lo vendes a ${money(Number(input.basePrice))} por ${readable} (${num(scale)} ${stock.code}).`
          : `Lo vendes a ${money(Number(input.basePrice))} por cada ${num(scale)} ${stock.code}.`,
      );
    } else {
      lines.push(
        `Lo vendes a ${money(Number(input.basePrice))} por ${stock.code}.`,
      );
    }
  }

  for (const p of presentations) {
    const packSize = Number(p.packSize);
    const readable = describeStockQuantity(packSize, stock, catalog);
    const equivalence = readable
      ? `${readable} (${num(packSize)} ${stock.code})`
      : `${num(packSize)} ${stock.code}`;
    lines.push(
      p.price != null
        ? `${p.name}: ${money(Number(p.price))} y descuenta ${equivalence}.`
        : `${p.name} descuenta ${equivalence}.`,
    );
  }

  if (!lines.length) {
    lines.push(
      `Define el precio para que el sistema sepa cuánto cobrar por ${stock.code}.`,
    );
  }

  return { headline, lines };
}
