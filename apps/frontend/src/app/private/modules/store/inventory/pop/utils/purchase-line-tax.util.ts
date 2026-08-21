/**
 * Derivación fiscal de una línea de compra — espejo EXACTO del backend.
 *
 * El backend (`purchase-orders.service.ts` → `deriveLineTax` /
 * `prorateHeaderDiscount`) es la única autoridad sobre lo que se persiste:
 * ignora `subtotal_amount` / `tax_amount` / `total_amount` del DTO y recalcula
 * todo desde `unit_price`, `discount_*` y `tax_rate`.
 *
 * Este archivo existe porque el frontend necesita mostrar ESA misma cifra antes
 * de enviarla. Cualquier fórmula paralela —un factor proporcional, un subtotal
 * sin descuento— produce un número que el operador aprueba y que la base de
 * datos luego contradice.
 *
 * Regla de negocio que la fórmula codifica (QUI-661): el descuento comercial se
 * resta del BRUTO **antes** del split de IVA. En Colombia un descuento comercial
 * incondicional reduce la base gravable; derivar el IVA del precio sin descontar
 * infla el IVA descontable que llega a la declaración y capitaliza el inventario
 * a un costo que nunca se pagó.
 *
 * Al tocar este archivo hay que tocar el backend en el mismo commit, o dejan de
 * ser espejo.
 */

/** Línea mínima que la derivación necesita. Compatible con `PopCartItem`, `MatchedLineItem` y el DTO. */
export interface PurchaseLineTaxInput {
  /** Precio unitario BRUTO (antes de descuento y antes del split de IVA). */
  unit_price?: number | null;
  /** Alias de `unit_price` — el carrito lo llama `unit_cost`. */
  unit_cost?: number | null;
  quantity?: number | null;
  /** PORCENTAJE (19 = 19%), nunca fracción. El escáner emite fracción y la convierte antes. */
  tax_rate?: number | null;
  /** Override por línea del modo de cabecera (facturas mixtas). */
  prices_include_tax?: boolean | null;
  /** Descuento propio de la línea en PORCENTAJE. */
  discount_percentage?: number | null;
  /** Descuento propio de la línea en DINERO. Gana sobre el porcentaje. */
  discount_amount?: number | null;
}

export interface PurchaseLineTaxResult {
  /** Precio unitario NETO tras descuento y sin IVA — lo que se persiste como `unit_cost`. */
  unit_price_net: number;
  tax_amount_per_unit: number;
  /** IVA total de la línea. */
  tax_amount: number;
  effective_include: boolean;
  /** Descuento total aplicado a la línea (propio + prorrateo de cabecera), en dinero. */
  discount_total: number;
  /** Bruto de la línea antes de descuento: `unit_price × quantity`. */
  gross_line: number;
  /** Base gravable de la línea: `unit_price_net × quantity`. */
  net_line: number;
  /** Total de la línea: base gravable + IVA. */
  total_line: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Espejo de `PurchaseOrdersService.deriveLineTax`.
 *
 * `proratedHeaderDiscount` viaja como argumento explícito —igual que en el
 * backend— para que ningún llamador pueda contarlo dos veces dejándolo también
 * dentro de `discount_amount`.
 */
export function deriveLineTax(
  item: PurchaseLineTaxInput,
  header: { prices_include_tax?: boolean | null },
  proratedHeaderDiscount = 0,
): PurchaseLineTaxResult {
  const gross = Number(item.unit_price ?? item.unit_cost ?? 0) || 0;
  const quantity = Number(item.quantity ?? 0) || 0;
  const r = (Number(item.tax_rate ?? 0) || 0) / 100;
  const effective_include =
    item.prices_include_tax ?? header.prices_include_tax ?? false;

  // `discount_amount` gana sobre `discount_percentage`: el usuario puede teclear
  // cualquiera de los dos, pero la cifra en dinero es la que se persiste y la que
  // lee la contabilidad. Re-derivarla del porcentaje daría otro número el día que
  // cambie el precio.
  const ownDiscount =
    item.discount_amount != null && Number(item.discount_amount) > 0
      ? Number(item.discount_amount)
      : gross * quantity * ((Number(item.discount_percentage ?? 0) || 0) / 100);

  const discount_total = Math.max(
    0,
    ownDiscount + (Number(proratedHeaderDiscount) || 0),
  );

  // Un descuento nunca puede volver la línea negativa: un descuento mayor que la
  // línea es un error de datos, y un costo negativo envenena la capa FIFO.
  const discountPerUnit =
    quantity > 0 ? Math.min(discount_total / quantity, gross) : 0;
  const grossAfterDiscount = gross - discountPerUnit;

  let unit_price_net: number;
  let tax_amount_per_unit: number;
  if (!(r > 0)) {
    // Sin tasa (o tasa inválida) → línea sin impuesto, el costo queda como se tecleó.
    unit_price_net = grossAfterDiscount;
    tax_amount_per_unit = 0;
  } else if (effective_include) {
    // El precio ya trae el IVA dentro: se extrae para obtener el costo neto.
    unit_price_net = grossAfterDiscount / (1 + r);
    tax_amount_per_unit = grossAfterDiscount - unit_price_net;
  } else {
    // El IVA se suma encima: el precio tecleado ya es neto.
    unit_price_net = grossAfterDiscount;
    tax_amount_per_unit = grossAfterDiscount * r;
  }

  const net_line = unit_price_net * quantity;
  const tax_amount = tax_amount_per_unit * quantity;

  return {
    unit_price_net,
    tax_amount_per_unit,
    tax_amount,
    effective_include,
    discount_total: discountPerUnit * quantity,
    gross_line: gross * quantity,
    net_line,
    total_line: net_line + tax_amount,
  };
}

/**
 * Espejo de `PurchaseOrdersService.prorateHeaderDiscount`.
 *
 * El descuento de cabecera no puede quedarse en la cabecera: las capas de costo
 * FIFO se escriben por línea, así que una cifra que sólo vive en
 * `purchase_orders.discount_amount` no tiene forma física de llegar al costo del
 * producto.
 *
 * El residuo de redondeo cae en la ÚLTIMA línea para que
 * `Σ prorrateado === headerDiscount` exacto y el total de la orden no derive un
 * centavo contra lo que facturó el proveedor.
 */
export function prorateHeaderDiscount(
  items: Array<Pick<PurchaseLineTaxInput, 'unit_price' | 'unit_cost' | 'quantity'>>,
  headerDiscount: number,
): number[] {
  const shares = new Array(items.length).fill(0);
  const discount = Number(headerDiscount || 0);
  if (!(discount > 0) || items.length === 0) return shares;

  const grossPerLine = items.map(
    (i) => (Number(i.unit_price ?? i.unit_cost ?? 0) || 0) * (Number(i.quantity ?? 0) || 0),
  );
  const grossTotal = grossPerLine.reduce((s, v) => s + v, 0);
  // Un descuento sobre una orden de valor cero no tiene a qué agarrarse;
  // descartarlo es más seguro que dividir por cero y emitir NaN al motor de costo.
  if (!(grossTotal > 0)) return shares;

  // Nunca descontar más de lo que vale la orden.
  const effective = Math.min(discount, grossTotal);

  let assigned = 0;
  for (let i = 0; i < items.length - 1; i++) {
    shares[i] = round2((grossPerLine[i] / grossTotal) * effective);
    assigned += shares[i];
  }
  shares[items.length - 1] = round2(effective - assigned);
  return shares;
}

export interface PurchaseTotals {
  /** Σ bruto antes de cualquier descuento. */
  gross_subtotal: number;
  /** Σ descuentos propios de línea. */
  line_discount: number;
  /** Descuento de cabecera efectivamente aplicado (topado al bruto). */
  header_discount: number;
  /** Σ descuentos (línea + cabecera). */
  discount_amount: number;
  /** Base gravable tras descuentos. */
  subtotal: number;
  tax_amount: number;
  shipping_cost: number;
  total: number;
}

/**
 * Totales de un conjunto de líneas, con el descuento de cabecera prorrateado
 * exactamente como lo hará el backend al persistir.
 *
 * Es el único punto donde se suman líneas. Cualquier vista —modal del escáner,
 * carrito, resumen— consume esto en vez de sumar por su cuenta, que es como el
 * pie del modal terminó contradiciendo a sus propias filas.
 */
export function derivePurchaseTotals(
  items: PurchaseLineTaxInput[],
  header: { prices_include_tax?: boolean | null },
  headerDiscount = 0,
  shippingCost = 0,
): PurchaseTotals {
  const shares = prorateHeaderDiscount(items, headerDiscount);

  let gross_subtotal = 0;
  let subtotal = 0;
  let tax_amount = 0;
  let discount_amount = 0;

  items.forEach((item, i) => {
    const d = deriveLineTax(item, header, shares[i]);
    gross_subtotal += d.gross_line;
    subtotal += d.net_line;
    tax_amount += d.tax_amount;
    discount_amount += d.discount_total;
  });

  const header_discount = shares.reduce((s, v) => s + v, 0);
  const shipping = Number(shippingCost) || 0;

  return {
    gross_subtotal: round2(gross_subtotal),
    line_discount: round2(discount_amount - header_discount),
    header_discount: round2(header_discount),
    discount_amount: round2(discount_amount),
    subtotal: round2(subtotal),
    tax_amount: round2(tax_amount),
    shipping_cost: shipping,
    total: round2(round2(subtotal) + round2(tax_amount) + shipping),
  };
}
