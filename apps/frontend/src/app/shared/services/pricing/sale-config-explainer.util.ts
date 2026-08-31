/**
 * Explica en lenguaje del comerciante cómo quedó configurado un producto.
 *
 * Tres pantallas describen lo mismo —el editor de producto, el modal de
 * configuración dentro de una compra y el POS—, así que la frase se genera en
 * un solo lugar. Si cada una la escribiera por su cuenta terminarían
 * contradiciéndose en el primer cambio de contrato, que es exactamente lo que
 * hace que un comerciante desconfíe de lo que ve.
 *
 * Es una función pura (sin DI, sin señales) para poder espejarla en el backend
 * igual que `packaging.util`.
 */

export interface SaleConfigUnit {
  code: string;
  name: string;
}

export interface SaleConfigPresentation {
  /** Nombre de la presentación tal como lo verá el cajero: "Rollo 20 m". */
  name: string;
  /** Unidades de stock que consume una presentación. */
  packSize: number;
  /** Precio del paquete completo, ya resuelto. `null` = hereda la tarifa. */
  price?: number | null;
}

export interface SaleConfigInput {
  /** Unidad en la que vive el inventario. `null` = el producto va por pieza. */
  stockUnit?: SaleConfigUnit | null;
  /** Unidades de stock que cubre `basePrice`. `1` = precio por unidad. */
  priceUnitQuantity?: number | null;
  /** Precio base del producto, en la escala de `priceUnitQuantity`. */
  basePrice?: number | null;
  /** Presentaciones habilitadas del producto. */
  presentations?: SaleConfigPresentation[];
  /** Catálogo de unidades de la misma dimensión, para traducir cantidades. */
  catalog?: Array<SaleConfigUnit & { dimension?: string; factorToBase: number }>;
  /** Dimensión de la unidad de stock, si se conoce (para filtrar el catálogo). */
  dimension?: string | null;
  /** Formateador de dinero. Por defecto, pesos sin decimales. */
  formatMoney?: (value: number) => string;
  /** El producto tiene variantes: el eje de medida es otro. */
  hasVariants?: boolean;
}

export interface SaleConfigExplanation {
  /** Frase corta que encabeza la tarjeta. */
  headline: string;
  /** Detalle: una línea por hecho configurado. */
  lines: string[];
}

const defaultMoney = (value: number): string =>
  `$${Math.round(value).toLocaleString('es-CO')}`;

const num = (value: number): string => value.toLocaleString('es-CO');

/**
 * Traduce una cantidad de unidades de stock a la unidad más legible del
 * catálogo: 20000 mm → "20 m". Devuelve `null` cuando no hay una equivalencia
 * entera, porque redondear aquí sería mentirle al comerciante.
 */
export function describeStockQuantity(
  quantity: number,
  stockUnit: SaleConfigUnit & { factorToBase?: number },
  catalog: Array<SaleConfigUnit & { dimension?: string; factorToBase: number }> = [],
  dimension?: string | null,
): string | null {
  const sf = Number(stockUnit.factorToBase ?? 1);
  if (!Number.isFinite(sf) || sf <= 0) return null;
  const candidates = catalog
    .filter((u) => (!dimension || u.dimension === dimension) && u.factorToBase > sf)
    .map((u) => ({ unit: u, value: (quantity * sf) / u.factorToBase }))
    .filter(({ value }) => value >= 1 && Number.isInteger(value))
    .sort((a, b) => a.value - b.value);
  const best = candidates[0];
  return best ? `${num(best.value)} ${best.unit.code}` : null;
}

export function buildSaleConfigExplanation(
  input: SaleConfigInput,
): SaleConfigExplanation {
  const money = input.formatMoney ?? defaultMoney;
  const stock = input.stockUnit ?? null;
  const scale = Number(input.priceUnitQuantity ?? 1) || 1;
  const presentations = (input.presentations ?? []).filter(
    (p) => Number(p.packSize) > 1,
  );
  const catalog = input.catalog ?? [];
  const stockWithFactor = stock
    ? {
        ...stock,
        factorToBase:
          catalog.find((u) => u.code === stock.code)?.factorToBase ?? 1,
      }
    : null;

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
    const headline = 'Este producto se vende por pieza.';
    if (input.basePrice != null && input.basePrice > 0) {
      lines.push(`Cada unidad cuesta ${money(Number(input.basePrice))}.`);
    }
    if (presentations.length) {
      for (const p of presentations) {
        lines.push(
          p.price != null
            ? `${p.name}: ${money(Number(p.price))} y descuenta ${num(Number(p.packSize))} unidades.`
            : `${p.name} descuenta ${num(Number(p.packSize))} unidades.`,
        );
      }
    }
    return { headline, lines };
  }

  const headline = `El stock se cuenta en ${stock.name.toLowerCase()} (${stock.code}).`;

  if (input.basePrice != null && input.basePrice > 0) {
    if (scale > 1) {
      const readable = stockWithFactor
        ? describeStockQuantity(scale, stockWithFactor, catalog, input.dimension)
        : null;
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
    const readable = stockWithFactor
      ? describeStockQuantity(packSize, stockWithFactor, catalog, input.dimension)
      : null;
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

/** Ejemplo por industria: precarga una configuración válida de un clic. */
export interface SaleConfigExample {
  id: string;
  label: string;
  description: string;
  /** Código de la unidad de stock a preseleccionar. */
  stockUnitCode: string;
  /** Escala del precio, en unidades de stock. */
  priceUnitQuantity: number;
  /** Presentación sugerida, expresada en unidades de stock. */
  presentation?: { name: string; packSize: number };
}

/**
 * Los tres casos que motivaron la feature. No son plantillas cerradas: llenan
 * los campos y el comerciante ajusta. Su valor está en que la primera vez
 * alguien vea un ejemplo completo en vez de tres campos vacíos.
 */
export const SALE_CONFIG_EXAMPLES: SaleConfigExample[] = [
  {
    id: 'ferreteria-cable',
    label: 'Ferretería · cable',
    description: 'Stock en milímetros, precio por metro y presentación por rollo.',
    stockUnitCode: 'mm',
    priceUnitQuantity: 1000,
    presentation: { name: 'Rollo 20 m', packSize: 20000 },
  },
  {
    id: 'distribuidora-caja',
    label: 'Distribuidora · caja y unidad',
    description: 'Stock por unidad, precio por unidad y presentación por caja.',
    stockUnitCode: 'unit',
    priceUnitQuantity: 1,
    presentation: { name: 'Caja x12', packSize: 12 },
  },
  {
    id: 'restaurante-insumo',
    label: 'Restaurante · insumo',
    description: 'Stock en gramos y precio por kilo para recetas y compras.',
    stockUnitCode: 'g',
    priceUnitQuantity: 1000,
  },
];
