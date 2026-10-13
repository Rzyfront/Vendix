import {
  CreateCreditNoteDto,
  Invoice,
  InvoiceItem,
  InvoiceNoteContextLine,
} from '../../interfaces/invoice.interface';

/** Una línea de la factura con la cantidad que el usuario decidió corregir. */
export interface NoteLineSelection {
  item: InvoiceItem;
  quantity: number;
  unit_price?: number;
  discount_amount?: number;
  unit_code?: string;
  context?: InvoiceNoteContextLine;
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

/** UI-only estimate; server response remains authoritative. */
export function estimateLine(selection: NoteLineSelection): {
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  base: number;
  total: number;
} {
  const { item, context } = selection;
  const quantity = selection.quantity;
  const originalQty = num(item.quantity);
  const qty = Math.max(0, Number(quantity) || 0);
  const factor = originalQty > 0 ? qty / originalQty : 0;
  const unit_price = selection.unit_price ?? num(item.unit_price);
  const priceUnitQuantity = num(context?.price_unit_quantity ?? item.price_unit_quantity) || 1;
  // An explicit discount replaces the effective captured source allowance.
  const discount_amount = round2(
    selection.discount_amount ?? num(context?.discount_amount ?? item.discount_amount) * factor,
  );
  const lineValue = round2((qty * unit_price) / priceUnitQuantity - discount_amount);
  let tax_amount: number;
  let base: number;
  let total: number;

  if (context) {
    const inclusiveRate = context.taxes
      .filter((tax) => tax.is_inclusive)
      .reduce((sum, tax) => sum + taxFactor(num(tax.tax_rate), tax.rate_basis), 0);
    base = context.is_inclusive && inclusiveRate > 0
      ? round2(lineValue / (1 + inclusiveRate))
      : lineValue;
    tax_amount = round2(context.taxes.reduce((sum, tax) => {
      const rate = taxFactor(num(tax.tax_rate), tax.rate_basis);
      return sum + base * rate;
    }, 0));
    const exclusiveTax = round2(context.taxes
      .filter((tax) => !tax.is_inclusive)
      .reduce((sum, tax) => sum + base * taxFactor(num(tax.tax_rate), tax.rate_basis), 0));
    total = round2(lineValue + exclusiveTax);
  } else {
    // Legacy invoices without note context can only use their captured tax amount.
    tax_amount = round2(num(item.tax_amount) * factor);
    base = lineValue;
    total = round2(base + tax_amount);
  }

  return {
    quantity: qty,
    unit_price,
    discount_amount,
    tax_amount,
    base,
    total,
  };
}

function taxFactor(rate: number, basis: InvoiceNoteContextLine['taxes'][number]['rate_basis']): number {
  if (basis === 'per_mil') return rate / 1000;
  if (basis === 'fraction') return rate;
  return rate / 100;
}

export function noteTotals(selections: NoteLineSelection[]): NoteTotals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let total = 0;
  for (const selection of selections) {
    const scaled = estimateLine(selection);
    const priceUnitQuantity = num(selection.context?.price_unit_quantity ?? selection.item.price_unit_quantity) || 1;
    subtotal += (scaled.quantity * scaled.unit_price) / priceUnitQuantity;
    discount += scaled.discount_amount;
    tax += scaled.tax_amount;
    total += scaled.total;
  }
  subtotal = round2(subtotal);
  discount = round2(discount);
  tax = round2(tax);
  return { subtotal, discount, tax, total: round2(total) };
}

/** Minimal writable payload: source and editable commercial values only. */
export function buildNoteItems(
  selections: NoteLineSelection[],
): CreateCreditNoteDto['items'] {
  return selections.map((selection) => {
    const { item } = selection;
    const scaled = estimateLine(selection);
    return {
      source_invoice_item_id: selection.context?.source_invoice_item_id ?? item.id,
      quantity: scaled.quantity,
      unit_price: scaled.unit_price,
      discount_amount: scaled.discount_amount,
      ...((selection.unit_code ?? selection.context?.unit_code ?? item.unit_code)
        ? { unit_code: selection.unit_code ?? selection.context?.unit_code ?? item.unit_code! }
        : {}),
    };
  });
}

/**
 * El concepto DIAN va DELANTE y entre corchetes porque el texto que produce
 * termina en `cbc:Description`/`cbc:Note` —el lado LEGIBLE de la corrección—,
 * y el prefijo sigue puesto AUNQUE el código ya viaje aparte en
 * `note_concept_code` → `cbc:ResponseCode`: son las dos mitades del mismo
 * grupo UBL, el código lo lee un validador y la descripción la lee una
 * persona.
 */
function buildNotePrefixedText(
  conceptCode: string,
  conceptLabel: string,
  reason: string,
): string {
  const text = (reason ?? '').trim();
  const prefix = `[Concepto DIAN ${conceptCode} — ${conceptLabel}]`;
  return `${prefix} ${text}`.trim();
}

/**
 * Por qué estos dos topes son literales locales y NO viven en `CONFIG_LIMITS`
 * (`core/utils/invoice-profile-config.contract.ts`), pese a que el orquestador
 * pidió medir si la fuente única los admite (2026-08-25):
 *
 * `CONFIG_LIMITS` es el contrato de configuración de UN PERFIL de
 * facturación — sus 17 campos (`account_code`, `mapping_key`, `header_note`,
 * …) acotan cómo se ARMA un perfil, no cómo se crea un documento. `reason` y
 * `notes` de nota crédito/débito no configuran nada: son texto libre de
 * `CreateCreditNoteDto`/`CreateDebitNoteDto`, un DTO de creación de
 * documento sin relación de dominio con el de perfiles. Que `header_note`
 * (tope de `CreateInvoiceDto.notes`, FAD13) también valga 500 es
 * COINCIDENCIA de cifra, no de origen: son dos `@MaxLength` distintos en dos
 * clases distintas, que hoy comparten número porque ambos heredan del mismo
 * ancho de columna, no porque uno derive del otro. Importar
 * `CONFIG_LIMITS.header_note` aquí ataría el tope de `reason` al día en que
 * alguien cambie el de las notas de FACTURA sin querer tocar el de nota
 * crédito/débito — el acoplamiento que se busca evitar, no el que se busca
 * crear. Se quedan como constantes propias de este archivo, con su fuente
 * (el DTO real) citada en cada docblock.
 */

/** Tope de `reason` en el DTO (`@MaxLength(500)`, `create-credit-note.dto.ts`). */
export const NOTE_REASON_LIMIT = 500;

/**
 * Tope de `notes` en el DTO desde F.6 (`@MaxLength(5000)`, reglas CAD11/DAD11
 * de `create-credit-note.dto.ts`).
 */
export const NOTE_TEXT_LIMIT = 5000;

/**
 * El texto que queda registrado como `reason` — el CAMPO CORTO,
 * `cac:DiscrepancyResponse/cbc:Description`.
 *
 * Se recorta a 500: nunca el concepto, siempre el texto libre. Perder el
 * prefijo sería perder el único dato estructurado que un validador lee.
 */
export function buildNoteReason(
  conceptCode: string,
  conceptLabel: string,
  reason: string,
): string {
  return buildNotePrefixedText(conceptCode, conceptLabel, reason)
    .slice(0, NOTE_REASON_LIMIT)
    .trim();
}

/**
 * El texto que queda registrado como `notes` — el CAMPO LARGO, `cbc:Note` del
 * documento (F.6: 5.000 caracteres, CAD11/DAD11).
 *
 * ## Por qué esto existía en el código y nunca se mandaba
 *
 * Antes de F.6 sólo existía `reason` (500), así que un motivo de 800
 * caracteres se recortaba EN SILENCIO a 500 y el sobrante se perdía para
 * siempre — ni error, ni aviso, sólo una frase cortada a mitad de camino en
 * el XML firmado. F.6 amplió `notes` a 5.000 en el backend
 * (`create-credit-note.dto.ts`, commit `e2276653f`), pero el frontend nunca
 * llegó a mandarlo: `credit-notes.service.ts` ya sabe usar `dto.notes` con
 * fallback a `dto.reason` (`:303`), y este productor nunca poblaba el
 * primero. El mismo texto que el usuario tecleó ahora viaja completo por acá
 * — `reason` sigue yendo aparte, recortado, como resumen estructurado.
 */
export function buildNoteText(
  conceptCode: string,
  conceptLabel: string,
  reason: string,
): string {
  return buildNotePrefixedText(conceptCode, conceptLabel, reason)
    .slice(0, NOTE_TEXT_LIMIT)
    .trim();
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
    // Y la PROSA CORTA, que sigue viajando: alimenta `cbc:Description` del
    // mismo `cac:DiscrepancyResponse` y el detalle de la nota en el panel.
    reason: buildNoteReason(conceptCode, conceptLabel, reason),
    // Y la PROSA COMPLETA (F.6, hasta 5.000): alimenta `cbc:Note` del
    // documento. Sin esto, un motivo más largo que 500 caracteres se perdía
    // en silencio — `reason` lo recortaba y nada más lo recogía completo.
    notes: buildNoteText(conceptCode, conceptLabel, reason),
  };

  if (scope === 'total') {
    return base;
  }

  // Partial note lines carry only source + editable commercial values. The server derives all fiscal fields.
  return {
    ...base,
    items: buildNoteItems(selections),
  };
}
