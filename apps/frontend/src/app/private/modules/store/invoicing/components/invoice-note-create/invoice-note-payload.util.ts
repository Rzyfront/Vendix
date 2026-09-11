/**
 * CÓMO SE ARMA EL CUERPO DE UNA NOTA CRÉDITO O DÉBITO.
 *
 * Aparte del componente a propósito: es aritmética fiscal, y la aritmética
 * fiscal se lee y se prueba mejor sin un template alrededor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LAS DOS FORMAS DE NOTA, Y POR QUÉ LA PARCIAL YA NO MANDA SUS IMPUESTOS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Nota TOTAL** — no se manda `items` ni `taxes`. El backend copia las
 * líneas de la factura y también sus impuestos. Es el camino que funciona
 * entero y el que hay que preferir siempre que la corrección sea por el
 * documento completo.
 *
 * **Nota PARCIAL** — se manda SOLO `items`, nunca `taxes` (F-073). Mandar el
 * desglose desde el navegador activaba el camino explícito del DTO con
 * floats, y la nota podía diferir de la factura en centavos. Los impuestos
 * los deriva el servidor por el kernel (`derivePartialNoteLinesViaKernel`
 * en `credit-notes.service.ts`): la cuota persistida ES `trunc(base × tasa)`
 * por construcción y la cabecera suma lo derivado, nunca el reclamo del
 * cliente. Quien necesite un desglose distinto al derivado usa el camino
 * explícito del DTO a propósito, no este formulario.
 */

import {
  CreateCreditNoteDto,
  CreateInvoiceItemDto,
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

  // Parcial: SOLO `items`, nunca `taxes` (F-073 round 2). Los impuestos los
  // deriva el servidor por el kernel (`derivePartialNoteLinesViaKernel`):
  // mandar el desglose del navegador activaría el camino explícito con
  // floats (`scaleLine` sin divisor) y la nota podría diferir de la factura
  // en centavos. Quien necesite un desglose distinto al derivado usa el
  // camino explícito del DTO a propósito, no este formulario.
  return {
    ...base,
    items: buildNoteItems(selections),
  };
}
