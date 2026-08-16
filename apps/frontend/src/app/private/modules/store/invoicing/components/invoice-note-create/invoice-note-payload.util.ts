/**
 * CÓMO SE ARMA EL CUERPO DE UNA NOTA CRÉDITO O DÉBITO.
 *
 * Aparte del componente a propósito: es aritmética fiscal, y la aritmética
 * fiscal se lee y se prueba mejor sin un template alrededor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LAS DOS FORMAS DE NOTA, Y POR QUÉ LA PARCIAL TIENE QUE MANDAR SUS IMPUESTOS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Nota TOTAL** — no se manda `items` ni `taxes`. `credit-notes.service.ts:142`
 * copia las líneas de la factura y `:170` copia también sus impuestos. Es el
 * camino que hoy funciona entero y el que hay que preferir siempre que la
 * corrección sea por el documento completo.
 *
 * **Nota PARCIAL** — se manda `items`. Y entonces HAY QUE MANDAR `taxes`
 * TAMBIÉN. La razón está en `credit-notes.service.ts:166-177`:
 *
 * ```ts
 * const taxes = dto.taxes?.length ? dto.taxes
 *   : dto.items?.length ? []                 // ← acá
 *   : <copia los de la factura>;
 * ```
 *
 * Con `items` y sin `taxes`, el servicio se queda con `[]` y el spread de
 * `:242` (`...(taxes.length > 0 && {...})`) NO crea ninguna fila en
 * `invoice_taxes`. Pero la cabecera SÍ suma el impuesto: `:186` acumula
 * `item.tax_amount` y `:188` lo mete en `total_amount`. Resultado: una nota con
 * `LegalMonetaryTotal` que incluye IVA y sin un solo `cac:TaxTotal` en el XML
 * (`UblCreditNoteBuilder` recibe `taxes: []`). Esa es la familia de rechazos de
 * consistencia aritmética de la DIAN.
 *
 * Así que el desglose se manda, y se manda DERIVADO DE LAS MISMAS CIFRAS que
 * viajan en las líneas —no de un recálculo paralelo—. Por construcción,
 * `Σ taxes[].tax_amount === Σ items[].tax_amount`, que es exactamente lo que el
 * backend va a poner en la cabecera. Dos fuentes distintas para el mismo número
 * es de donde salen los descuadres de un peso.
 */

import {
  CreateCreditNoteDto,
  CreateInvoiceItemDto,
  CreateInvoiceTaxDto,
  Invoice,
  InvoiceItem,
} from '../../interfaces/invoice.interface';

/** Una línea de la factura con la cantidad que el usuario decidió corregir. */
export interface NoteLineSelection {
  item: InvoiceItem;
  quantity: number;
}

export interface NoteTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/**
 * Dinero colombiano a dos decimales.
 *
 * `Math.round(x * 100) / 100` y no `toFixed`: `toFixed` devuelve string y
 * obliga a un `Number()` de vuelta en cada uso, que es donde se cuela el
 * `NaN` silencioso.
 */
export function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Prisma serializa `Decimal` como string. Normalizar una vez, comparar números. */
export function num(value: number | string | null | undefined): number {
  const parsed = typeof value === 'string' ? Number(value) : (value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Las líneas del documento, con el nombre real de Prisma primero. */
export function invoiceLines(invoice: Invoice | null): InvoiceItem[] {
  return invoice?.invoice_items ?? invoice?.items ?? [];
}

/**
 * La tarifa efectiva de una línea, en PORCENTAJE.
 *
 * `tax_rate` viene `null` en casi toda línea histórica (el desglose por tarifa
 * vive en la cabecera, no en la línea), así que cuando falta se deduce de los
 * importes que sí están. Redondear a dos decimales evita que `19.000000001`
 * abra un grupo de impuesto propio por un error de coma flotante.
 */
export function lineTaxRate(item: InvoiceItem): number {
  const declared = num(item.tax_rate);
  if (declared > 0) {
    return round2(declared);
  }
  const base = num(item.quantity) * num(item.unit_price) - num(item.discount_amount);
  const tax = num(item.tax_amount);
  if (base <= 0 || tax <= 0) {
    return 0;
  }
  return round2((tax / base) * 100);
}

/**
 * Los importes de una selección parcial, prorrateados por cantidad.
 *
 * El factor se aplica al DESCUENTO y al IMPUESTO, no solo a la cantidad:
 * devolver 2 de 5 unidades devuelve 2/5 del descuento de esa línea y 2/5 de su
 * IVA. Prorratear la cantidad y arrastrar el descuento entero produciría una
 * nota que descuenta más de lo que factura.
 */
export function scaleLine(item: InvoiceItem, quantity: number): {
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  base: number;
  total: number;
} {
  const originalQty = num(item.quantity);
  const qty = Math.max(0, Number(quantity) || 0);
  const factor = originalQty > 0 ? qty / originalQty : 0;

  const unit_price = num(item.unit_price);
  const discount_amount = round2(num(item.discount_amount) * factor);
  const tax_amount = round2(num(item.tax_amount) * factor);
  const base = round2(qty * unit_price - discount_amount);

  return {
    quantity: qty,
    unit_price,
    discount_amount,
    tax_amount,
    base,
    total: round2(base + tax_amount),
  };
}

/** Totales de la nota, con la MISMA fórmula que `credit-notes.service.ts:183-188`. */
export function noteTotals(selections: NoteLineSelection[]): NoteTotals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const selection of selections) {
    const scaled = scaleLine(selection.item, selection.quantity);
    subtotal += scaled.quantity * scaled.unit_price;
    discount += scaled.discount_amount;
    tax += scaled.tax_amount;
  }
  subtotal = round2(subtotal);
  discount = round2(discount);
  tax = round2(tax);
  return { subtotal, discount, tax, total: round2(subtotal - discount + tax) };
}

/**
 * Las líneas, en el formato que valida `CreateInvoiceItemDto`.
 *
 * `description` es obligatoria y `@IsNotEmpty` corre DESPUÉS de un `trim`, así
 * que una línea cuyo `description` esté vacío pero tenga `product_name` usa el
 * nombre del producto en vez de mandar un blanco que el backend rechazaría con
 * un 400 poco explicable.
 */
export function buildNoteItems(
  selections: NoteLineSelection[],
): CreateInvoiceItemDto[] {
  return selections.map(({ item, quantity }) => {
    const scaled = scaleLine(item, quantity);
    const description = (item.description || item.product_name || '').trim();
    return {
      ...(item.product_id ? { product_id: item.product_id } : {}),
      description: description || 'Línea de la factura corregida',
      quantity: scaled.quantity,
      unit_price: scaled.unit_price,
      discount_amount: scaled.discount_amount,
      tax_amount: scaled.tax_amount,
    };
  });
}

/**
 * El desglose de impuestos de una nota parcial, agrupado por tarifa.
 *
 * Se agrupan los MISMOS importes ya redondeados que van en las líneas, así que
 * la suma de este arreglo es idéntica al `tax_amount` que el backend va a
 * calcular sumando las líneas. No hay un segundo cálculo que pueda diferir.
 *
 * `tax_name` y `tax_type` se toman del desglose de la factura corregida cuando
 * hay una tarifa que coincide: la nota debe declarar el MISMO tributo que
 * corrige, y bautizarlo «IVA» por defecto convertiría un INC en IVA delante de
 * la DIAN. Solo si la factura no trae esa tarifa se cae al rótulo genérico.
 *
 * Los grupos sin cuota no se emiten: una nota sobre líneas sin impuesto no
 * lleva `cac:TaxTotal`, y `taxes: []` es justo lo que el backend interpreta
 * como «esta nota no tiene impuestos».
 */
export function buildNoteTaxes(
  invoice: Invoice,
  selections: NoteLineSelection[],
): CreateInvoiceTaxDto[] {
  const headerTaxes = invoice.invoice_taxes ?? invoice.taxes ?? [];
  const groups = new Map<number, { taxable_amount: number; tax_amount: number }>();

  for (const { item, quantity } of selections) {
    const scaled = scaleLine(item, quantity);
    if (scaled.tax_amount <= 0) {
      continue;
    }
    const rate = lineTaxRate(item);
    const current = groups.get(rate) ?? { taxable_amount: 0, tax_amount: 0 };
    current.taxable_amount = round2(current.taxable_amount + scaled.base);
    current.tax_amount = round2(current.tax_amount + scaled.tax_amount);
    groups.set(rate, current);
  }

  return [...groups.entries()].map(([rate, amounts]) => {
    const source = headerTaxes.find((tax) => round2(num(tax.tax_rate)) === rate);
    return {
      tax_name: source?.tax_name ?? `IVA ${rate}%`,
      tax_rate: rate,
      taxable_amount: amounts.taxable_amount,
      tax_amount: amounts.tax_amount,
      ...(source?.tax_type ? { tax_type: source.tax_type } : {}),
    };
  });
}

/**
 * El texto que queda registrado como motivo de la corrección.
 *
 * El concepto va DELANTE y entre corchetes porque ese texto termina en
 * `cbc:Description` del `cac:DiscrepancyResponse`, que es el lado LEGIBLE del
 * mismo grupo: quien abra el XML o el detalle de la nota lee ahí, en español,
 * qué corrección se hizo.
 *
 * El prefijo sigue puesto AUNQUE el código ya viaje aparte en
 * `note_concept_code` → `cbc:ResponseCode`. No es redundancia inútil: son las
 * dos mitades del mismo grupo UBL —el código lo lee un validador, la
 * descripción la lee una persona— y quitar el prefijo dejaría la descripción
 * sin decir de qué concepto habla.
 */
export function buildNoteReason(
  conceptCode: string,
  conceptLabel: string,
  reason: string,
): string {
  const text = (reason ?? '').trim();
  const prefix = `[Concepto DIAN ${conceptCode} — ${conceptLabel}]`;
  // 500 es el `@MaxLength` de `reason` en el DTO. Se recorta el texto libre,
  // nunca el concepto: perder el prefijo es perder el único dato estructurado.
  return `${prefix} ${text}`.slice(0, 500).trim();
}

/**
 * El cuerpo completo de la petición.
 *
 * `scope === 'total'` omite `items` y `taxes` DELIBERADAMENTE: mandar la copia
 * de las líneas desde el navegador sería reimplementar en el cliente lo que el
 * backend ya hace con los datos de primera mano, y abriría la puerta a que una
 * nota total y su factura difieran en un centavo.
 */
export function buildNotePayload(params: {
  invoice: Invoice;
  scope: 'total' | 'partial';
  conceptCode: string;
  conceptLabel: string;
  reason: string;
  selections: NoteLineSelection[];
}): CreateCreditNoteDto {
  const { invoice, scope, conceptCode, conceptLabel, reason, selections } = params;

  const base: CreateCreditNoteDto = {
    related_invoice_id: invoice.id,
    // El CÓDIGO, estructurado. Es lo que el backend persiste en
    // `invoices.note_concept_code` y el builder emite en `cbc:ResponseCode`.
    // Antes de que este campo existiera el XML salía siempre con '2'
    // («Anulación de factura electrónica» / «Gastos por cobrar»), así que una
    // nota por descuento declaraba una anulación.
    note_concept_code: conceptCode,
    // Y la PROSA, que sigue viajando: alimenta `cbc:Description` del mismo
    // `cac:DiscrepancyResponse` y el detalle de la nota en el panel.
    reason: buildNoteReason(conceptCode, conceptLabel, reason),
  };

  if (scope === 'total') {
    return base;
  }

  return {
    ...base,
    items: buildNoteItems(selections),
    taxes: buildNoteTaxes(invoice, selections),
  };
}
