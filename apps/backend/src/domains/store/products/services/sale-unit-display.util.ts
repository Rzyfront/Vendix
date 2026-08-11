/**
 * Cantidades expresadas en la UNIDAD DE VENTA del producto, para reportes y
 * analíticas.
 *
 * El inventario guarda todo en la unidad mínima de su dimensión (mm, g, ml,
 * unidad) porque es la única escala entera que no pierde mercancía al
 * redondear. Esa decisión es correcta para la base de datos y pésima para un
 * reporte: un cable vendido "3 metros" se imprime `3000`, sin unidad, y el
 * comerciante concluye que el reporte está mal —o peor, que le falta
 * inventario—. En la hoja de Detalle el daño es además aritmético: la columna
 * `Precio Unitario` ya viene en la escala comercial ($5.000 por metro), así que
 * la fila afirmaba 3000 × 5.000 = 15.000 y no cuadraba con nada.
 *
 * Este helper traduce la cantidad a la unidad en la que el producto se VENDE.
 * Hay tres maneras de vender y por eso hay tres reglas, evaluadas en orden:
 *
 *   1. Por presentación (`order_items.stock_units_consumed` no nulo). La línea
 *      cuenta PAQUETES, no unidades mínimas: `quantity` ya está en la unidad
 *      correcta y lo único que falta es el nombre del paquete ("Caja x 12").
 *      Dividir aquí por la escala de precio contaría dos veces el empaque.
 *   2. Por escala de precio (`price_unit_quantity > 1`). El producto publica su
 *      precio cada N unidades mínimas, así que la cantidad se divide por N y se
 *      etiqueta con la unidad del catálogo EQUIVALENTE a esa escala. Cuando no
 *      existe equivalencia no se inventa una: se deja la cantidad cruda con el
 *      código de la unidad de stock, que es literal y verificable.
 *   3. Ni una ni otra. Cantidad cruda. Si el producto declara una unidad de
 *      stock distinta de `unit` se añade su código (un insumo en gramos dice
 *      "g"); si no declara ninguna, no se añade NADA.
 *
 * La regla 3 es la que garantiza cero regresión: el catálogo abrumadoramente
 * mayoritario —sin `stock_uom_id` y con `price_unit_quantity = 1`— sale por ahí
 * y produce exactamente el mismo número que antes, sin sufijo, sin cambio de
 * formato.
 *
 * Funciones puras + un resolutor por lote. El `client` entra por parámetro (el
 * mismo criterio que `price-unit.util.ts`) para poder recibir el `tx` de una
 * transacción: tomar `this.prisma` adentro abriría una segunda conexión del
 * pool y perdería el scoping de tenant.
 */

/** Unidad mínima de conteo. Escribir "3 unit" en una celda es ruido, no dato. */
const COUNT_BASE_UOM_CODE = 'unit';

/**
 * Tolerancia al comparar `factor_to_base` (Decimal(18,6)) contra una escala
 * entera. La igualdad exacta entre un Decimal serializado y un `number` no está
 * garantizada, y un fallo silencioso aquí degrada al caso "sin equivalencia".
 */
const FACTOR_EPSILON = 1e-6;

/** Redondeo de presentación: evita que 3050/1000 salga como 3.0500000000000003. */
function roundQuantity(value: number): number {
  return Number(value.toFixed(6));
}

export interface SaleUnitContext {
  /** Escala de precio vigente para la fila (snapshot de la línea si existe). */
  priceUnitQuantity?: number | null;
  /** Código de la unidad de stock del producto (`mm`, `g`, `ml`, `unit`, …). */
  stockUomCode?: string | null;
  /** Código de la unidad equivalente a la escala de precio, si el catálogo la tiene. */
  saleUnitCode?: string | null;
  /** Nombre de la presentación aplicada ("Caja x 12"), cuando se vendió empacado. */
  presentationName?: string | null;
  /** `order_items.stock_units_consumed`: presente ⇒ la línea cuenta paquetes. */
  stockUnitsConsumed?: number | null;
}

export interface SaleUnitQuantity {
  /** Cantidad ya convertida. Sigue siendo un número real: Excel la suma y ordena. */
  value: number;
  /** Sufijo de unidad (`m`, `g`, `Caja x 12`). Cadena vacía = sin unidad que declarar. */
  suffix: string;
  /** `value` y `suffix` juntos, para superficies que no tienen dos celdas (PDF, chat). */
  label: string;
}

/**
 * Sufijo de la unidad de stock. `unit` y los vacíos no aportan información —el
 * default histórico ES la unidad— y devolverlos rompería la promesa de que un
 * producto normal imprime hoy lo mismo que ayer.
 */
function stockSuffix(stockUomCode?: string | null): string {
  const code = (stockUomCode ?? '').trim();
  if (!code) return '';
  return code.toLowerCase() === COUNT_BASE_UOM_CODE ? '' : code;
}

function buildLabel(value: number, suffix: string): string {
  const formatted = value.toLocaleString('es-CO', { maximumFractionDigits: 6 });
  return suffix ? `${formatted} ${suffix}` : formatted;
}

/**
 * Traduce una cantidad guardada en unidades mínimas a la unidad de venta.
 *
 * Nunca lanza: una cantidad no numérica cae a 0 y un contexto vacío devuelve la
 * cantidad tal cual, sin sufijo. Un reporte jamás debe fallar por no saber
 * nombrar una unidad.
 */
export function formatQuantityInSaleUnit(
  quantity: number | null | undefined,
  context: SaleUnitContext = {},
): SaleUnitQuantity {
  const raw = Number(quantity);
  const qty = Number.isFinite(raw) ? raw : 0;

  // Regla 1 — vendido por presentación: `quantity` ya cuenta paquetes.
  if (context.stockUnitsConsumed != null) {
    const suffix = (context.presentationName ?? '').trim();
    const value = roundQuantity(qty);
    return { value, suffix, label: buildLabel(value, suffix) };
  }

  // Regla 2 — precio por N unidades mínimas: la escala ES la unidad de venta.
  const scale = Number(context.priceUnitQuantity ?? 1);
  if (Number.isFinite(scale) && scale > 1) {
    const equivalent = (context.saleUnitCode ?? '').trim();
    if (equivalent) {
      const value = roundQuantity(qty / scale);
      return { value, suffix: equivalent, label: buildLabel(value, equivalent) };
    }
    // Sin unidad equivalente en el catálogo no se convierte: mostrar "0,003 ?"
    // sería peor que mostrar el número que la base realmente guarda.
    const suffix = stockSuffix(context.stockUomCode);
    const value = roundQuantity(qty);
    return { value, suffix, label: buildLabel(value, suffix) };
  }

  // Regla 3 — comportamiento histórico, con el código de stock solo si aporta.
  const suffix = stockSuffix(context.stockUomCode);
  const value = roundQuantity(qty);
  return { value, suffix, label: buildLabel(value, suffix) };
}

/** Configuración de venta de un producto, resuelta una sola vez por reporte. */
export interface SaleUnitInfo {
  /** `products.price_unit_quantity` vigente en el catálogo. */
  priceUnitQuantity: number;
  stockUomCode: string | null;
  stockUomDimension: string | null;
  /** `factor_to_base` de la unidad de stock. 1 cuando es la unidad mínima. */
  stockUomFactorToBase: number;
  /** Unidad equivalente a la escala VIGENTE del catálogo. */
  saleUnitCode: string | null;
  /**
   * Unidad equivalente a una escala arbitraria. Existe porque una línea de
   * venta guarda su propio `price_unit_quantity`: si el comerciante cambia hoy
   * la escala del producto, el reporte del año pasado tiene que seguir diciendo
   * lo que dijo entonces (mismo criterio que el snapshot de costo).
   */
  saleUnitCodeForScale: (scale: number | null | undefined) => string | null;
}

export type SaleUnitClient = {
  products: { findMany: (args: any) => Promise<any[]> };
  units_of_measure: { findMany: (args: any) => Promise<any[]> };
};

type CatalogUnit = {
  code: string;
  dimension: string | null;
  factorToBase: number;
};

/**
 * Resuelve la configuración de venta de un lote de productos.
 *
 * Dos lecturas como máximo y nunca N+1: una a `products` (con su unidad de
 * stock embebida) y —solo si algún producto declara unidad de stock— una al
 * catálogo global `units_of_measure`, que son dos docenas de filas y se trae
 * completo para poder resolver también las escalas históricas de cada línea.
 *
 * Los productos que no tienen nada que declarar (escala 1 y sin unidad de
 * stock, o con `unit`) quedan FUERA del mapa a propósito: quien no encuentra
 * entrada emite la cantidad cruda, que es exactamente el comportamiento previo.
 */
export async function resolveSaleUnitCodes(
  client: SaleUnitClient,
  productIds: readonly (number | null | undefined)[],
): Promise<Map<number, SaleUnitInfo>> {
  const out = new Map<number, SaleUnitInfo>();

  // `id != null` va PRIMERO y no es redundante: `Number(null)` es 0, así que un
  // filtro puramente numérico convierte cada línea sin producto (servicios,
  // items sueltos del POS) en una consulta por el producto id 0.
  const ids = Array.from(
    new Set(
      productIds
        .filter((id): id is number => id != null && Number(id) > 0)
        .map(Number),
    ),
  );
  if (ids.length === 0) return out;

  const products =
    (await client.products.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        price_unit_quantity: true,
        stock_uom: {
          select: { code: true, dimension: true, factor_to_base: true },
        },
      },
    })) ?? [];

  type Draft = {
    id: number;
    scale: number;
    code: string | null;
    dimension: string | null;
    factor: number;
  };

  const drafts: Draft[] = [];
  for (const row of products) {
    const scaleRaw = Number(row?.price_unit_quantity ?? 1);
    const scale = Number.isFinite(scaleRaw) && scaleRaw > 1 ? scaleRaw : 1;
    const uom = row?.stock_uom ?? null;
    const code: string | null = uom?.code ?? null;
    const factorRaw = Number(uom?.factor_to_base ?? 1);
    const factor = Number.isFinite(factorRaw) && factorRaw > 0 ? factorRaw : 1;

    // Nada que declarar ⇒ no entra al mapa (ver doc de la función).
    if (scale <= 1 && stockSuffix(code) === '') continue;

    drafts.push({
      id: Number(row.id),
      scale,
      code,
      dimension: uom?.dimension ?? null,
      factor,
    });
  }
  if (drafts.length === 0) return out;

  // El catálogo solo hace falta si hay alguna unidad de stock contra la cual
  // buscar equivalencias; un producto con escala pero sin unidad no la tiene.
  const needsCatalog = drafts.some((d) => d.code !== null);
  let catalog: CatalogUnit[] = [];
  if (needsCatalog) {
    const rows =
      (await client.units_of_measure.findMany({
        where: { is_active: true },
        select: { code: true, dimension: true, factor_to_base: true },
      })) ?? [];
    catalog = rows.map((u) => ({
      code: String(u.code),
      dimension: (u.dimension as string) ?? null,
      factorToBase: Number(u.factor_to_base ?? 0),
    }));
  }

  for (const draft of drafts) {
    /**
     * La escala se expresa en unidades de STOCK, y la equivalencia vive en
     * unidades BASE de la dimensión: hay que multiplicar por el factor de la
     * unidad de stock antes de buscar. Con la unidad mínima (factor 1, que es
     * lo que el modelo garantiza hoy) la multiplicación es la identidad y la
     * búsqueda queda en `factor_to_base === price_unit_quantity`; con `cm`
     * como unidad de stock —posible si el catálogo cambia— seguiría acertando.
     */
    const resolve = (scale: number | null | undefined): string | null => {
      const n = Number(scale ?? 1);
      if (!Number.isFinite(n) || n <= 1) return null;
      if (!draft.code || !draft.dimension) return null;
      const target = n * draft.factor;
      const match = catalog.find(
        (u) =>
          u.dimension === draft.dimension &&
          Math.abs(u.factorToBase - target) < FACTOR_EPSILON,
      );
      return match ? match.code : null;
    };

    out.set(draft.id, {
      priceUnitQuantity: draft.scale,
      stockUomCode: draft.code,
      stockUomDimension: draft.dimension,
      stockUomFactorToBase: draft.factor,
      saleUnitCode: resolve(draft.scale),
      saleUnitCodeForScale: resolve,
    });
  }

  return out;
}

/**
 * Azúcar para el caso dominante en reportes agregados: una fila por producto,
 * sin presentación ni snapshot de línea. Devuelve la cantidad convertida y el
 * sufijo listos para dos celdas ("Cantidad" numérica + "Unidad" de texto).
 */
export function formatAggregateQuantity(
  quantity: number | null | undefined,
  info?: SaleUnitInfo,
): SaleUnitQuantity {
  return formatQuantityInSaleUnit(quantity, {
    priceUnitQuantity: info?.priceUnitQuantity,
    stockUomCode: info?.stockUomCode,
    saleUnitCode: info?.saleUnitCode,
  });
}

/**
 * Factor por el que hay que dividir una cantidad en unidades de stock para
 * expresarla en la unidad de venta agregada. Devuelve 1 cuando no hay
 * conversión posible, de modo que multiplicar o dividir por él sea inocuo.
 *
 * Existe para las filas donde la conversión de la cantidad obliga a reescalar
 * su acompañante monetario: si "Existencias" pasa de 3000 mm a 3 m, el "Costo
 * Unitario" tiene que pasar de $/mm a $/m o el "Valor Total" de la misma fila
 * deja de ser el producto de sus dos vecinos.
 */
export function saleUnitScaleFactor(info?: SaleUnitInfo): number {
  if (!info) return 1;
  if (!info.saleUnitCode) return 1;
  const scale = Number(info.priceUnitQuantity ?? 1);
  return Number.isFinite(scale) && scale > 1 ? scale : 1;
}
