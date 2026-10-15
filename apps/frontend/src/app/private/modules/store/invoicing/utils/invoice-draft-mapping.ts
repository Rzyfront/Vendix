/**
 * Borrador IA de «Nueva factura» → controles del formulario.
 *
 * Todo aquí es PURO: recibe el resultado del escáner (`scan-draft`) y devuelve
 * patches con los nombres EXACTOS de los controles de `invoiceForm`, más las
 * rutas que la pantalla marca como «IA» (precargado) o «Revisar» (pendiente).
 * La página sólo aplica; las decisiones de mapeo viven y se prueban aquí.
 *
 * Nada de esto emite ni crea: el cliente nuevo viaja como `inline_customer`
 * al emitir, igual que con RUES.
 */
import type {
  TaxOption,
  TaxSelection,
} from '../../../../../shared/components/tax-selector';
import {
  DIAN_DOCUMENT_TYPE_SCHEME_IDS,
  getDianSchemeIdForDocumentType,
} from '../../../../../shared/constants/dian-document-types.constants';
import {
  isFiscalResponsibility,
  normalizeFiscalResponsibilityCode,
} from '../../../../../shared/constants/fiscal-responsibilities.constants';
import { computeNitDv } from '../../../../../shared/utils/nit.util';
import type {
  CreateCustomerRequest,
  PersonType,
  TaxRegime,
} from '../../customers/models/customer.model';
import {
  PAYMENT_FORM_CASH,
  PAYMENT_FORM_CREDIT,
  PAYMENT_MEANS_OPTIONS,
  TAX_REGIME_OPTIONS,
  UNIT_CODE_DEFAULT,
  UNIT_CODE_OPTIONS,
} from '../components/invoice-create/invoice-dian-catalogs';
import type {
  DraftField,
  DraftWithholdingType,
  InvoiceDraftAcquirer,
  InvoiceDraftAiu,
  InvoiceDraftLine,
  InvoiceDraftScanResult,
  InvoiceDraftWithholding,
} from '../interfaces/invoice-draft-scan.interface';
import { normalizeRatePercent } from './invoice-line-math';

/** Confianza 0-100 (misma escala y umbral que el backend): por debajo se marca «Revisar». */
export const DRAFT_LOW_CONFIDENCE = 75;

const text = (value: unknown): string =>
  value == null ? '' : String(value).trim();

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** ¿El campo trae un valor utilizable? (cadena no vacía, número finito, arreglo con algo). */
export function hasDraftValue<T>(
  field: DraftField<T> | null | undefined,
): field is DraftField<T> & { value: T } {
  if (!field) return false;
  const value = field.value as unknown;
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

function isLowConfidence(field: DraftField<unknown> | null | undefined): boolean {
  return (
    !!field &&
    typeof field.confidence === 'number' &&
    field.confidence < DRAFT_LOW_CONFIDENCE
  );
}

// ─────────────────────────────────────────────────────────────
// Documento del adquiriente
// ─────────────────────────────────────────────────────────────

/**
 * `identification_type_enum` del backend usa nombres largos donde la tabla
 * interna usa siglas (`PASSPORT` ⇒ `PA`). Lo que no se reconozca queda vacío.
 */
const DOCUMENT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  PASSPORT: 'PA',
  PASAPORTE: 'PA',
  CEDULA: 'CC',
  CEDULA_CIUDADANIA: 'CC',
  CEDULA_EXTRANJERIA: 'CE',
  FOREIGN_ID: 'CE',
  TARJETA_IDENTIDAD: 'TI',
};

/** Sigla interna (`NIT`, `CC`, `PA`…) o `''` si no se reconoce. */
export function draftDocumentSigla(raw: unknown): string {
  const upper = text(raw).toUpperCase();
  if (!upper) return '';
  const sigla = DOCUMENT_TYPE_ALIASES[upper] ?? upper;
  return DIAN_DOCUMENT_TYPE_SCHEME_IDS[sigla] ? sigla : '';
}

/** Código DIAN del tipo de documento (`'31'` para NIT) o `''`. */
export function draftDocumentTypeCode(raw: unknown): string {
  return getDianSchemeIdForDocumentType(draftDocumentSigla(raw));
}

/**
 * Número SIN el DV pegado y sin puntos: `900.123.456-7` ⇒ `900123456`. Mismo
 * criterio que `customerTaxIdBase` de la página.
 */
export function draftDocumentDigits(raw: unknown): string {
  const value = text(raw);
  const head = value.includes('-') ? value.split('-')[0] : value;
  return head.replace(/\D/g, '');
}

/**
 * Documento genérico que la DIAN reserva para ventas a consumidor final.
 * Fuente: anexo técnico (adquiriente «222222222222»).
 */
export const FINAL_CONSUMER_DOCUMENT = '222222222222';

/**
 * ¿El adquiriente es CONSUMIDOR FINAL? Sin número de documento (la forma en que
 * esta pantalla factura a consumidor final) o con el documento genérico
 * `222222222222`. Es la única excepción a la obligatoriedad del correo del
 * adquiriente en la captura manual.
 */
export function isFinalConsumerDocument(raw: unknown): boolean {
  const digits = draftDocumentDigits(raw);
  return digits === '' || digits === FINAL_CONSUMER_DOCUMENT;
}

/** Sigla efectiva: la leída o, si sólo vino número + DV, NIT. */
function acquirerSigla(acquirer: InvoiceDraftAcquirer): string {
  const sigla = hasDraftValue(acquirer.document_type)
    ? draftDocumentSigla(acquirer.document_type.value)
    : '';
  if (sigla) return sigla;
  const digits = hasDraftValue(acquirer.document_number)
    ? draftDocumentDigits(acquirer.document_number.value)
    : '';
  return digits && hasDraftValue(acquirer.verification_digit) ? 'NIT' : '';
}

/**
 * ¿El DV leído contradice el calculado con el módulo 11? Sólo aplica a NIT y
 * sólo si la IA leyó un DV: la pantalla nunca lo deja digitar, lo deriva, así
 * que una contradicción significa que el NUMERO quedó mal leído.
 */
export function draftNitDvMismatch(acquirer: InvoiceDraftAcquirer): boolean {
  if (acquirerSigla(acquirer) !== 'NIT') return false;
  if (!hasDraftValue(acquirer.document_number)) return false;
  if (!hasDraftValue(acquirer.verification_digit)) return false;
  const digits = draftDocumentDigits(acquirer.document_number.value);
  const expected = computeNitDv(digits);
  return !!expected && expected !== text(acquirer.verification_digit.value);
}

const TAX_REGIME_VALUES: ReadonlySet<string> = new Set(
  TAX_REGIME_OPTIONS.map((option) => String(option.value)),
);

export interface DraftAcquirerPatch {
  /** Controles del adquiriente para `patchValue`: sólo lo que la IA trajo. */
  patch: Record<string, unknown>;
  /** Controles escritos con un valor leído (marca «IA»). */
  aiPaths: string[];
  /** Número del documento sin DV, o `''`. */
  documentDigits: string;
  /** Sigla interna (`NIT`, `CC`…), o `''`. */
  documentSigla: string;
}

/**
 * Adquiriente leído ⇒ controles del adquiriente.
 *
 * - El DV no se marca: la pantalla lo DERIVA del número (módulo 11).
 * - Con documento que no es NIT el tipo de persona es NATURAL, sin preguntar.
 * - El municipio sólo entra si es un código DANE de 5 dígitos; ciudad y
 *   departamento viajan con él o no viajan (sin código la DIAN rechaza igual).
 * - Régimen y responsabilidades sólo si existen en los catálogos de la pantalla.
 */
export function draftToAcquirerPatch(
  acquirer: InvoiceDraftAcquirer,
): DraftAcquirerPatch {
  const patch: Record<string, unknown> = {};
  const aiPaths: string[] = [];
  const set = (control: string, value: unknown): void => {
    patch[control] = value;
    aiPaths.push(control);
  };

  const digits = hasDraftValue(acquirer.document_number)
    ? draftDocumentDigits(acquirer.document_number.value)
    : '';
  const sigla = acquirerSigla(acquirer);

  if (sigla) set('customer_document_type', getDianSchemeIdForDocumentType(sigla));
  if (digits) {
    set('customer_tax_id', digits);
    patch['customer_verification_digit'] =
      sigla === 'NIT' ? (computeNitDv(digits) ?? '') : '';
  }

  const draftPerson =
    hasDraftValue(acquirer.person_type) &&
    (acquirer.person_type.value === 'NATURAL' ||
      acquirer.person_type.value === 'JURIDICA')
      ? acquirer.person_type.value
      : null;
  if (sigla && sigla !== 'NIT') {
    patch['customer_person_type'] = 'NATURAL';
    if (draftPerson) aiPaths.push('customer_person_type');
  } else if (draftPerson) {
    set('customer_person_type', draftPerson);
  }

  if (hasDraftValue(acquirer.name)) set('customer_name', text(acquirer.name.value));
  if (hasDraftValue(acquirer.email)) set('customer_email', text(acquirer.email.value));
  if (hasDraftValue(acquirer.phone)) set('customer_phone', text(acquirer.phone.value));
  if (hasDraftValue(acquirer.address_line)) {
    set('customer_address', text(acquirer.address_line.value));
  }

  const municipality = hasDraftValue(acquirer.municipality_code)
    ? text(acquirer.municipality_code.value)
    : '';
  if (/^\d{5}$/.test(municipality)) {
    set('customer_municipality_code', municipality);
    patch['customer_city_name'] = hasDraftValue(acquirer.city_name)
      ? text(acquirer.city_name.value)
      : '';
    patch['customer_department_name'] = hasDraftValue(acquirer.department_name)
      ? text(acquirer.department_name.value)
      : '';
  }

  if (hasDraftValue(acquirer.tax_regime)) {
    const regime = text(acquirer.tax_regime.value).toUpperCase();
    if (TAX_REGIME_VALUES.has(regime)) set('customer_tax_regime', regime);
  }

  if (hasDraftValue(acquirer.fiscal_responsibilities)) {
    const codes = Array.from(
      new Set(
        acquirer.fiscal_responsibilities.value
          .map((code) => normalizeFiscalResponsibilityCode(code))
          .filter((code) => isFiscalResponsibility(code)),
      ),
    );
    if (codes.length > 0) set('customer_fiscal_responsibilities', codes);
  }

  return { patch, aiPaths, documentDigits: digits, documentSigla: sigla };
}

/**
 * Base del `inline_customer` para un adquiriente que no existe en la tienda ni
 * en la organización. `buildInlineCustomerFromForm` pisa al emitir todo lo que
 * la pantalla muestra (nombre, documento, correo, teléfono, régimen…); esta
 * base sólo aporta lo que la pantalla no expone (la sigla del tipo).
 */
export function draftToInlineCustomerBase(
  acquirer: InvoiceDraftAcquirer,
): CreateCustomerRequest {
  const { patch, documentDigits, documentSigla } = draftToAcquirerPatch(acquirer);
  const name = text(patch['customer_name']);
  const isNit = documentSigla === 'NIT';
  const person: PersonType =
    (patch['customer_person_type'] as PersonType | undefined) ??
    (isNit ? 'JURIDICA' : 'NATURAL');
  const base: CreateCustomerRequest = {
    email: text(patch['customer_email']),
    first_name: person === 'NATURAL' ? name : '',
    last_name: '',
    legal_name: person === 'JURIDICA' ? name || null : null,
    document_type: documentSigla || null,
    document_number: documentDigits || null,
    verification_digit: isNit ? (computeNitDv(documentDigits) ?? null) : null,
    person_type: person,
  };
  const regime = text(patch['customer_tax_regime']);
  if (regime) base.tax_regime = regime as TaxRegime;
  const responsibilities = patch['customer_fiscal_responsibilities'];
  if (Array.isArray(responsibilities) && responsibilities.length > 0) {
    base.fiscal_responsibilities = [...(responsibilities as string[])];
  }
  return base;
}

// ─────────────────────────────────────────────────────────────
// Cabecera y pago
// ─────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` real (no `2026-02-31`). */
export function isDateOnly(value: unknown): value is string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Suma días a una fecha SOLO-FECHA en UTC: sin huso no hay día corrido. */
export function addDaysToDateOnly(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + Math.trunc(days)))
    .toISOString()
    .slice(0, 10);
}

const stripAccents = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Pista libre del medio de pago («transferencia Bancolombia», «tarjeta de
 * crédito») ⇒ código DIAN del selector, o `null` si no se reconoce. Un código
 * que ya sea del catálogo (`'42'`) pasa tal cual.
 */
export function draftPaymentMeansCode(hint: unknown): string | null {
  const raw = text(hint);
  if (!raw) return null;
  const exact = PAYMENT_MEANS_OPTIONS.find(
    (option) => String(option.value).toLowerCase() === raw.toLowerCase(),
  );
  if (exact) return String(exact.value);
  const h = stripAccents(raw.toLowerCase());
  if (/tarjeta/.test(h)) return /debito/.test(h) ? '49' : '48';
  if (/cheque/.test(h)) return '20';
  if (/consignaci/.test(h)) return '42';
  if (/transferencia|pse|ach/.test(h)) return /credito/.test(h) ? '45' : '47';
  if (/efectivo|cash/.test(h)) return '10';
  if (/acuerdo/.test(h)) return 'ZZZ';
  return null;
}

export interface DraftInvoiceContext {
  /** «Hoy» en la zona de la tienda (`storeToday`). */
  today: string;
  /** Notas que el formulario ya tiene: se conservan y lo leído se agrega. */
  currentNotes: string;
  notesLimit: number;
  /** Divisas que el selector de la pantalla ofrece (ISO 4217). */
  foreignCurrencies: readonly string[];
}

export interface DraftInvoicePatch {
  /** `issue_date`, `payment_form`, `payment_means_code`, `notes`, divisa. */
  patch: Record<string, unknown>;
  /**
   * Vencimiento a escribir DESPUÉS de `syncDueDate()` (que en crédito habilita
   * y vacía el control). `null` = no tocarlo.
   */
  dueDate: string | null;
  aiPaths: string[];
  /** Lo leído que la pantalla no pudo representar, en palabras. */
  unresolved: string[];
}

/**
 * Cabecera y pago leídos ⇒ controles de «Documento».
 *
 * - `cash`/`credit` ⇒ `'1'`/`'2'`. Sin forma leída pero con plazo o
 *   vencimiento posterior, es crédito.
 * - Vencimiento: el leído; si no, emisión + plazo en días (sólo en crédito).
 * - La REFERENCIA no tiene control propio: viaja dentro de las notas
 *   («Referencia: OC-123»), que se agregan a las que ya hubiera, con el tope.
 * - COP no toca nada; otra divisa sólo si el selector la ofrece, y con ella
 *   la TRM y su fecha si el documento las imprime.
 */
export function draftToInvoicePatch(
  result: Pick<InvoiceDraftScanResult, 'invoice' | 'payment'>,
  ctx: DraftInvoiceContext,
): DraftInvoicePatch {
  const patch: Record<string, unknown> = {};
  const aiPaths: string[] = [];
  const unresolved: string[] = [];
  const { invoice, payment } = result;

  const issueDate =
    hasDraftValue(invoice.issue_date) && isDateOnly(invoice.issue_date.value)
      ? text(invoice.issue_date.value)
      : null;
  if (issueDate) {
    patch['issue_date'] = issueDate;
    aiPaths.push('issue_date');
  }
  const baseDate = issueDate ?? ctx.today;

  const readDue =
    hasDraftValue(invoice.due_date) && isDateOnly(invoice.due_date.value)
      ? text(invoice.due_date.value)
      : null;
  const termDays =
    hasDraftValue(payment.payment_term_days) &&
    Number(payment.payment_term_days.value) > 0
      ? Math.trunc(Number(payment.payment_term_days.value))
      : 0;

  let form: string | null = null;
  if (hasDraftValue(payment.payment_form)) {
    if (payment.payment_form.value === 'credit') form = PAYMENT_FORM_CREDIT;
    else if (payment.payment_form.value === 'cash') form = PAYMENT_FORM_CASH;
  }
  if (!form && (termDays > 0 || (readDue !== null && readDue > baseDate))) {
    form = PAYMENT_FORM_CREDIT;
  }
  if (form) {
    patch['payment_form'] = form;
    aiPaths.push('payment_form');
  }

  let dueDate: string | null = null;
  if (form === PAYMENT_FORM_CREDIT) {
    dueDate = readDue ?? (termDays > 0 ? addDaysToDateOnly(baseDate, termDays) : null);
    if (dueDate) aiPaths.push('due_date');
  }

  if (hasDraftValue(payment.payment_method_hint)) {
    const code = draftPaymentMeansCode(payment.payment_method_hint.value);
    if (code) {
      patch['payment_means_code'] = code;
      aiPaths.push('payment_means_code');
    } else {
      unresolved.push(
        `Medio de pago «${text(payment.payment_method_hint.value)}» sin equivalente DIAN: elígelo a mano.`,
      );
    }
  }

  const noteParts = [
    hasDraftValue(invoice.notes) ? text(invoice.notes.value) : '',
    hasDraftValue(invoice.reference)
      ? `Referencia: ${text(invoice.reference.value)}`
      : '',
  ].filter(Boolean);
  if (noteParts.length > 0) {
    const current = text(ctx.currentNotes);
    const combined = noteParts.join('\n');
    const full = current ? `${current}\n${combined}` : combined;
    patch['notes'] = full.slice(0, ctx.notesLimit);
    aiPaths.push('notes');
  }

  if (hasDraftValue(invoice.currency)) {
    const code = text(invoice.currency.value).toUpperCase();
    if (code && code !== 'COP') {
      if (ctx.foreignCurrencies.includes(code)) {
        patch['use_foreign_currency'] = true;
        patch['foreign_currency'] = code;
        aiPaths.push('foreign_currency');
        // TRM impresa: la pantalla sólo consulta la oficial si el control está
        // vacío, así que la leída se respeta y queda marcada para revisión.
        const rate = invoice.exchange_rate;
        if (hasDraftValue(rate) && Number(rate.value) > 0) {
          patch['exchange_rate'] = Number(rate.value);
          aiPaths.push('exchange_rate');
          const rateDate = invoice.exchange_rate_date;
          if (hasDraftValue(rateDate) && isDateOnly(rateDate.value)) {
            patch['exchange_rate_date'] = text(rateDate.value);
            aiPaths.push('exchange_rate_date');
          }
        }
      } else {
        unresolved.push(
          `Moneda ${code} no disponible en la factura: queda en pesos (COP).`,
        );
      }
    }
  }

  return { patch, dueDate, aiPaths, unresolved };
}

// ─────────────────────────────────────────────────────────────
// Líneas
// ─────────────────────────────────────────────────────────────

/**
 * Impuesto del catálogo con la MISMA tarifa (en porcentaje). Sólo tributos que
 * se cobran en la línea: retenciones e ICA (por mil) no son candidatos. Entre
 * varios con la misma tarifa gana el IVA. El precio leído se toma como BASE
 * (impuesto adicional, `is_inclusive: false`): es como cotizan las facturas y
 * órdenes de compra, y la vista previa de totales lo deja a la vista.
 */
export function draftTaxSelectionForRate(
  ratePercent: number,
  taxes: readonly TaxOption[],
): TaxSelection | null {
  const target = normalizeRatePercent(ratePercent);
  if (target <= 0) return null;
  const candidates = taxes.filter((tax) => {
    const type = text(tax.tax_type).toLowerCase();
    if (type.startsWith('rete') || type === 'ica') return false;
    return Math.abs(normalizeRatePercent(tax.rate) - target) < 0.005;
  });
  const pick =
    candidates.find((tax) => text(tax.tax_type).toLowerCase() === 'iva') ??
    candidates[0];
  if (!pick) return null;
  return {
    tax_rate_id: pick.id,
    rate: pick.rate,
    name: pick.name,
    ...(pick.tax_type ? { tax_type: pick.tax_type } : {}),
    is_inclusive: false,
  };
}

/** Valores de UNA fila de `items`, con los nombres de sus controles. */
export interface DraftLineValue {
  product_id: number | null;
  product_variant_id: number | null;
  product_name: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  taxes: TaxSelection[];
  /** UN/ECE rec. 20; la leída si la pantalla la ofrece, si no `NIU`. */
  unit_code: string;
}

/** Códigos de unidad que ofrece el selector de la fila. */
const UNIT_CODE_VALUES: ReadonlySet<string> = new Set(
  UNIT_CODE_OPTIONS.map((option) => String(option.value)),
);

export interface DraftLineInput {
  /** Índice de la línea en el borrador (para cruzar `lines.N.*`). */
  draftIndex: number;
  value: DraftLineValue;
  /** Controles de la fila escritos por la IA. */
  aiFields: string[];
  /** Controles de la fila por revisar (más `product` si el vínculo es dudoso). */
  pendingFields: string[];
  /** Motivo corto para la fila, o `null`. */
  note: string | null;
}

const formatRate = (rate: number): string =>
  `${String(rate).replace('.', ',')} %`;

/**
 * Líneas leídas ⇒ filas del `FormArray` `items`.
 *
 * - Con `product_id` y coincidencia (`matched`/`partial`) es línea de
 *   CATÁLOGO, con su variante; `partial` queda «Revisar: producto». Sin
 *   coincidencia es ítem libre (el backend ya admite `product_id` vacío).
 * - El descuento leído es PORCENTAJE; la fila guarda IMPORTE:
 *   cantidad × precio × % / 100, a dos decimales.
 * - Tarifa 0 ⇒ sin impuestos. Tarifa sin equivalente en el catálogo ⇒ sin
 *   impuestos y «Revisar: impuesto»: inventar un tributo sería peor.
 * - Cantidad ≤ 0 o ausente ⇒ 1, y por revisar; precio ausente ⇒ 0, por revisar.
 * - Unidad leída del selector (`KGM`, `HUR`…) o `NIU` por defecto.
 * - Lo escrito con confianza baja también queda por revisar.
 */
export function draftLinesToLineInputs(
  lines: readonly InvoiceDraftLine[],
  taxes: readonly TaxOption[],
): DraftLineInput[] {
  return lines.map((line, draftIndex) => {
    const aiFields: string[] = [];
    const pendingFields: string[] = [];
    const notes: string[] = [];
    const lowConfidence = (field: DraftField<unknown>, control: string): void => {
      if (isLowConfidence(field) && !pendingFields.includes(control)) {
        pendingFields.push(control);
      }
    };

    let description = '';
    if (hasDraftValue(line.description)) {
      description = text(line.description.value);
      aiFields.push('description');
      lowConfidence(line.description, 'description');
    } else {
      description = text(line.sku);
      pendingFields.push('description');
    }

    const linked =
      line.product_id != null && line.product_id > 0 && line.match_status !== 'none';
    if (linked && line.match_status === 'partial') {
      pendingFields.push('product');
      notes.push('Producto del catálogo por confirmar');
    } else if (!linked) {
      notes.push('Ítem libre: no está en el catálogo');
    }

    let quantity = 1;
    if (hasDraftValue(line.quantity) && Number(line.quantity.value) > 0) {
      quantity = Number(line.quantity.value);
      aiFields.push('quantity');
      lowConfidence(line.quantity, 'quantity');
    } else {
      pendingFields.push('quantity');
    }

    let unitPrice = 0;
    if (hasDraftValue(line.unit_price) && Number(line.unit_price.value) >= 0) {
      unitPrice = round2(Number(line.unit_price.value));
      aiFields.push('unit_price');
      lowConfidence(line.unit_price, 'unit_price');
    } else {
      pendingFields.push('unit_price');
    }

    let discountAmount = 0;
    if (hasDraftValue(line.discount_percent)) {
      const pct = Number(line.discount_percent.value);
      if (pct > 0 && pct <= 100) {
        discountAmount = round2((quantity * unitPrice * pct) / 100);
        aiFields.push('discount_amount');
        lowConfidence(line.discount_percent, 'discount_amount');
      } else if (pct < 0 || pct > 100) {
        pendingFields.push('discount_amount');
      }
    }

    let lineTaxes: TaxSelection[] = [];
    if (!hasDraftValue(line.tax_rate)) {
      pendingFields.push('taxes');
    } else {
      const rate = normalizeRatePercent(line.tax_rate.value);
      if (rate > 0) {
        const selection = draftTaxSelectionForRate(rate, taxes);
        if (selection) {
          lineTaxes = [selection];
          aiFields.push('taxes');
          lowConfidence(line.tax_rate, 'taxes');
        } else {
          pendingFields.push('taxes');
          notes.push(`Sin impuesto de ${formatRate(rate)} en el catálogo`);
        }
      }
    }

    // Unidad: sólo si es una de las del selector. Una leída que no se reconoce
    // deja `NIU` y lo dice en la nota (la fila no tiene marca de unidad).
    let unitCode = UNIT_CODE_DEFAULT;
    const unit = line.unit_code;
    if (hasDraftValue(unit) && UNIT_CODE_VALUES.has(text(unit.value).toUpperCase())) {
      unitCode = text(unit.value).toUpperCase();
      aiFields.push('unit_code');
    } else if (unit && !hasDraftValue(unit) && unit.warning) {
      notes.push('Unidad leída no reconocida: quedó «Unidad»');
    }

    return {
      draftIndex,
      value: {
        product_id: linked ? line.product_id : null,
        product_variant_id:
          linked && line.product_variant_id != null && line.product_variant_id > 0
            ? line.product_variant_id
            : null,
        product_name: linked ? description || text(line.sku) : '',
        description,
        quantity,
        unit_price: unitPrice,
        discount_amount: discountAmount,
        taxes: lineTaxes,
        unit_code: unitCode,
      },
      aiFields,
      pendingFields,
      note: notes.length > 0 ? notes.join(' · ') : null,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Pendientes («Revisar»)
// ─────────────────────────────────────────────────────────────

const ACQUIRER_PATH_TO_CONTROL: Readonly<Record<string, string>> = {
  document_type: 'customer_document_type',
  document_number: 'customer_tax_id',
  verification_digit: 'customer_tax_id',
  person_type: 'customer_person_type',
  name: 'customer_name',
  email: 'customer_email',
  phone: 'customer_phone',
  address_line: 'customer_address',
  city_name: 'customer_municipality_code',
  department_name: 'customer_municipality_code',
  municipality_code: 'customer_municipality_code',
  tax_regime: 'customer_tax_regime',
  fiscal_responsibilities: 'customer_fiscal_responsibilities',
};

const INVOICE_PATH_TO_CONTROL: Readonly<Record<string, string>> = {
  issue_date: 'issue_date',
  due_date: 'due_date',
  currency: 'foreign_currency',
  reference: 'notes',
  notes: 'notes',
  exchange_rate: 'exchange_rate',
  exchange_rate_date: 'exchange_rate_date',
};

const PAYMENT_PATH_TO_CONTROL: Readonly<Record<string, string>> = {
  payment_form: 'payment_form',
  payment_term_days: 'due_date',
  payment_method_hint: 'payment_means_code',
};

/**
 * Campos de fila SIN marca propia en la pantalla: no se marcan (ni la fila
 * entera). La unidad no reconocida ya va en la nota de la fila.
 */
const UNMARKED_LINE_FIELDS: ReadonlySet<string> = new Set(['unit_code']);

const LINE_PATH_TO_CONTROL: Readonly<Record<string, string>> = {
  description: 'description',
  quantity: 'quantity',
  unit_price: 'unit_price',
  discount_percent: 'discount_amount',
  tax_rate: 'taxes',
  product_id: 'product',
  product_variant_id: 'product',
  sku: 'product',
  match_status: 'product',
};

/**
 * Ruta del borrador (`acquirer.address_line`, `lines.2.tax_rate`) ⇒ ruta de la
 * pantalla: nombre del control de cabecera, `lines.N.<control de fila>` o
 * `lines.N` (la fila entera). `null` si no tiene representación.
 */
export function draftPathToControl(path: string): string | null {
  const parts = text(path).split('.');
  const [root, second, third] = parts;
  if (root === 'acquirer') return ACQUIRER_PATH_TO_CONTROL[second] ?? null;
  if (root === 'invoice') return INVOICE_PATH_TO_CONTROL[second] ?? null;
  if (root === 'payment') return PAYMENT_PATH_TO_CONTROL[second] ?? null;
  if (root === 'lines' && /^\d+$/.test(second ?? '')) {
    if (!third) return `lines.${second}`;
    if (UNMARKED_LINE_FIELDS.has(third)) return null;
    const control = LINE_PATH_TO_CONTROL[third];
    return control ? `lines.${second}.${control}` : `lines.${second}`;
  }
  return null;
}

/**
 * Rutas de pantalla a marcar «Revisar» por el borrador ENTERO (cabecera,
 * adquiriente y las `lines.N.*` que el backend señaló). Las reglas de cada
 * fila que nacen del mapeo (impuesto sin equivalente, cantidad ausente…) las
 * da `draftLinesToLineInputs`.
 *
 *  - Todo lo que el backend lista en `missing_fields` / `requires_review`.
 *  - Con documento leído y sin cliente reconocido: nombre, dirección y
 *    municipio DANE si no vinieron (son lo que la DIAN exige para emitir).
 *  - Correo ausente con un adquiriente que no es consumidor final (la
 *    captura manual lo exige para emitir).
 *  - DV leído que contradice el módulo 11: el número quedó mal leído.
 *  - Lo escrito con confianza baja.
 *  - Fecha de emisión distinta de hoy: la factura se emite con fecha real.
 *  - Crédito sin vencimiento ni plazo.
 */
export function draftPendingPaths(
  result: InvoiceDraftScanResult,
  ctx: { today: string },
): string[] {
  const out = new Set<string>();
  for (const path of [
    ...(result.missing_fields ?? []),
    ...(result.requires_review ?? []),
  ]) {
    const control = draftPathToControl(path);
    if (control) out.add(control);
  }

  const acquirer = result.acquirer;
  const hasDocument = hasDraftValue(acquirer.document_number);
  if (hasDocument && acquirer.existing_customer_id == null) {
    if (!hasDraftValue(acquirer.name)) out.add('customer_name');
    if (!hasDraftValue(acquirer.address_line)) out.add('customer_address');
    const municipality = hasDraftValue(acquirer.municipality_code)
      ? text(acquirer.municipality_code.value)
      : '';
    if (!/^\d{5}$/.test(municipality)) out.add('customer_municipality_code');
  }
  // Correo: obligatorio para emitir salvo consumidor final. Un borrador sin
  // correo deja el campo en «Revisar». Con cliente reconocido no se marca: el
  // correo sale de su ficha, y si la ficha tampoco lo tiene el faltante rojo
  // de la página («Requerido para emitir») ya lo nombra.
  if (
    acquirer.existing_customer_id == null &&
    !hasDraftValue(acquirer.email) &&
    !isFinalConsumerDocument(
      hasDraftValue(acquirer.document_number) ? acquirer.document_number.value : '',
    )
  ) {
    out.add('customer_email');
  }
  if (draftNitDvMismatch(acquirer)) out.add('customer_tax_id');

  for (const [key, control] of Object.entries(ACQUIRER_PATH_TO_CONTROL)) {
    const field = acquirer[key as keyof typeof acquirer] as
      | DraftField<unknown>
      | number
      | null;
    if (field && typeof field === 'object' && hasDraftValue(field) && isLowConfidence(field)) {
      out.add(control);
    }
  }
  for (const [key, control] of Object.entries(INVOICE_PATH_TO_CONTROL)) {
    const field = result.invoice[key as keyof typeof result.invoice] as
      | DraftField<unknown>
      | undefined;
    if (hasDraftValue(field) && isLowConfidence(field)) out.add(control);
  }
  for (const [key, control] of Object.entries(PAYMENT_PATH_TO_CONTROL)) {
    const field = result.payment[key as keyof typeof result.payment] as DraftField<unknown>;
    if (hasDraftValue(field) && isLowConfidence(field)) out.add(control);
  }

  const issue = result.invoice.issue_date;
  if (hasDraftValue(issue) && isDateOnly(issue.value) && issue.value !== ctx.today) {
    out.add('issue_date');
  }

  const payment = result.payment;
  if (
    hasDraftValue(payment.payment_form) &&
    payment.payment_form.value === 'credit' &&
    !(hasDraftValue(result.invoice.due_date) && isDateOnly(result.invoice.due_date.value)) &&
    !(hasDraftValue(payment.payment_term_days) && Number(payment.payment_term_days.value) > 0)
  ) {
    out.add('due_date');
  }

  return [...out];
}

// ─────────────────────────────────────────────────────────────
// Etiquetas para la revisión
// ─────────────────────────────────────────────────────────────

const DRAFT_PATH_LABELS: Readonly<Record<string, string>> = {
  'acquirer.document_type': 'Tipo de documento del adquiriente',
  'acquirer.document_number': 'Documento del adquiriente',
  'acquirer.verification_digit': 'Dígito de verificación',
  'acquirer.person_type': 'Tipo de persona',
  'acquirer.name': 'Nombre o razón social',
  'acquirer.email': 'Correo del adquiriente',
  'acquirer.phone': 'Teléfono del adquiriente',
  'acquirer.address_line': 'Dirección fiscal',
  'acquirer.city_name': 'Ciudad',
  'acquirer.department_name': 'Departamento',
  'acquirer.municipality_code': 'Municipio (DANE)',
  'acquirer.tax_regime': 'Régimen tributario',
  'acquirer.fiscal_responsibilities': 'Responsabilidades fiscales',
  'invoice.issue_date': 'Fecha de emisión',
  'invoice.due_date': 'Vencimiento',
  'invoice.currency': 'Moneda',
  'invoice.reference': 'Referencia',
  'invoice.notes': 'Notas',
  'invoice.exchange_rate': 'Tasa de cambio (TRM)',
  'invoice.exchange_rate_date': 'Fecha de la TRM',
  'aiu.administracion_percent': 'AIU: administración',
  'aiu.imprevistos_percent': 'AIU: imprevistos',
  'aiu.utilidad_percent': 'AIU: utilidad',
  'aiu.contract_object': 'AIU: objeto del contrato',
  'payment.payment_form': 'Forma de pago',
  'payment.payment_term_days': 'Plazo de pago',
  'payment.payment_method_hint': 'Medio de pago',
  'totals.subtotal': 'Subtotal',
  'totals.tax_total': 'Total de impuestos',
  'totals.total': 'Total',
};

const LINE_FIELD_LABELS: Readonly<Record<string, string>> = {
  description: 'descripción',
  quantity: 'cantidad',
  unit_price: 'precio unitario',
  discount_percent: 'descuento',
  tax_rate: 'impuesto',
  product_id: 'producto',
  product_variant_id: 'variante',
  sku: 'referencia (SKU)',
  match_status: 'producto',
  unit_code: 'unidad',
};

const WITHHOLDING_FIELD_LABELS: Readonly<Record<string, string>> = {
  type: 'clase',
  rate: 'tarifa',
};

/** `lines.1.tax_rate` ⇒ «Línea 2: impuesto». Lo desconocido se muestra tal cual. */
export function draftPathLabel(path: string): string {
  const known = DRAFT_PATH_LABELS[path];
  if (known) return known;
  const match = /^lines\.(\d+)(?:\.(\w+))?$/.exec(path);
  if (match) {
    const n = Number(match[1]) + 1;
    return match[2]
      ? `Línea ${n}: ${LINE_FIELD_LABELS[match[2]] ?? match[2]}`
      : `Línea ${n}`;
  }
  const withholding = /^withholdings\.(\d+)(?:\.(\w+))?$/.exec(path);
  if (withholding) {
    const n = Number(withholding[1]) + 1;
    return withholding[2]
      ? `Retención ${n}: ${WITHHOLDING_FIELD_LABELS[withholding[2]] ?? withholding[2]}`
      : `Retención ${n}`;
  }
  return path;
}

// ─────────────────────────────────────────────────────────────
// Retenciones
// ─────────────────────────────────────────────────────────────

/**
 * Concepto de retención del catálogo de la pantalla, en una forma común a las
 * dos superficies. `type` es `retefuente` / `reteiva` / `reteica` cuando se
 * conoce (la tienda lo trae; la plataforma lo deduce del nombre).
 */
export interface DraftWithholdingConcept {
  id: number;
  /** Lo que la fila muestra como concepto (`'2307 · Servicios'`). */
  label: string;
  name: string;
  /** Tarifa del catálogo en PORCENTAJE, o `null` si no la trae. */
  ratePercent: number | null;
  type: string | null;
}

/** Fila de `withholdings` que la página escribe. */
export interface DraftWithholdingRow {
  /** Índice en `result.withholdings` (para cruzar `withholdings.N.*`). */
  draftIndex: number;
  concept_id: number;
  concept: string;
  /** El ADQUIRIENTE retiene a quien factura: retención sufrida. */
  role: 'suffered';
  /** PORCENTAJE leído (la pantalla lo guarda en porcentaje). */
  rate: number;
  /**
   * `true` si el concepto se eligió sólo por la clase (ninguno del catálogo
   * tiene esa tarifa, o hubo varios iguales y decidió el texto impreso).
   */
  needsReview: boolean;
}

export interface DraftWithholdingsPlan {
  rows: DraftWithholdingRow[];
  /** Lo leído que no se pudo cruzar con el catálogo, en palabras. */
  unresolved: string[];
}

const WITHHOLDING_TYPE_LABELS: Readonly<Record<DraftWithholdingType, string>> = {
  retefuente: 'Retención en la fuente',
  reteiva: 'ReteIVA',
  reteica: 'ReteICA',
};

/** Clase de un concepto por su tipo declarado o, si falta, por su nombre/código. */
export function draftWithholdingConceptType(concept: {
  type?: string | null;
  name?: string | null;
  label?: string | null;
}): DraftWithholdingType | null {
  const declared = stripAccents(text(concept.type).toLowerCase());
  if (declared === 'retefuente' || declared === 'reteiva' || declared === 'reteica') {
    return declared;
  }
  if (declared === 'withholding') return 'retefuente';
  const haystack = stripAccents(`${text(concept.name)} ${text(concept.label)}`.toLowerCase());
  if (!haystack.trim()) return null;
  if (/\bica\b|reteica/.test(haystack)) return 'reteica';
  if (/\biva\b|reteiva/.test(haystack)) return 'reteiva';
  if (/fuente|retefuente|renta/.test(haystack)) return 'retefuente';
  return null;
}

const sameRate = (a: number, b: number): boolean => Math.abs(a - b) < 0.0001;

const formatPercent = (rate: number): string =>
  `${String(Math.round(rate * 10000) / 10000).replace('.', ',')} %`;

/**
 * Retenciones leídas ⇒ filas del `FormArray` `withholdings`.
 *
 * - Desde quien factura, la retención impresa por el comprador es SUFRIDA.
 * - Concepto: de la MISMA clase y con la MISMA tarifa del catálogo. Si hay
 *   varios, decide el concepto impreso (nombre que lo contiene); si sigue
 *   ambiguo, o si ninguno tiene esa tarifa pero hay uno solo de la clase, se
 *   elige con `needsReview`. Sin candidato, no se inventa: va a `unresolved`.
 * - La tarifa escrita es la LEÍDA (la del documento manda; la del catálogo
 *   sólo se propone al elegir concepto a mano).
 * - Una fila sin clase o sin tarifa válida no se escribe.
 */
export function draftWithholdingsToRows(
  withholdings: readonly InvoiceDraftWithholding[] | null | undefined,
  concepts: readonly DraftWithholdingConcept[],
): DraftWithholdingsPlan {
  const rows: DraftWithholdingRow[] = [];
  const unresolved: string[] = [];
  (withholdings ?? []).forEach((entry, draftIndex) => {
    const type = hasDraftValue(entry?.type) ? entry.type.value : null;
    const rate =
      hasDraftValue(entry?.rate) && Number(entry.rate.value) > 0
        ? Number(entry.rate.value)
        : null;
    if (!type || rate === null) {
      if (type || rate !== null || entry?.concept_hint) {
        unresolved.push(
          `Retención ${draftIndex + 1} sin clase o tarifa legible: agrégala a mano.`,
        );
      }
      return;
    }
    const label = `${WITHHOLDING_TYPE_LABELS[type]} ${formatPercent(rate)}`;
    if (concepts.length === 0) {
      unresolved.push(`${label}: el catálogo de conceptos no está disponible, agrégala a mano.`);
      return;
    }
    const ofType = concepts.filter((concept) => draftWithholdingConceptType(concept) === type);
    const sameTariff = ofType.filter(
      (concept) => concept.ratePercent != null && sameRate(Number(concept.ratePercent), rate),
    );
    const hint = stripAccents(text(entry.concept_hint).toLowerCase());
    const byHint = (list: readonly DraftWithholdingConcept[]): DraftWithholdingConcept[] =>
      hint
        ? list.filter((concept) =>
            stripAccents(`${concept.name} ${concept.label}`.toLowerCase()).includes(hint),
          )
        : [];

    let pick: DraftWithholdingConcept | null = null;
    let needsReview = false;
    if (sameTariff.length === 1) {
      pick = sameTariff[0];
    } else if (sameTariff.length > 1) {
      const hinted = byHint(sameTariff);
      pick = hinted.length === 1 ? hinted[0] : sameTariff[0];
      needsReview = hinted.length !== 1;
    } else {
      const hinted = byHint(ofType);
      if (hinted.length === 1) pick = hinted[0];
      else if (ofType.length === 1) pick = ofType[0];
      needsReview = true;
    }
    if (!pick) {
      unresolved.push(`${label} sin concepto equivalente en el catálogo: agrégala a mano.`);
      return;
    }
    if (isLowConfidence(entry.type) || isLowConfidence(entry.rate)) needsReview = true;
    rows.push({
      draftIndex,
      concept_id: pick.id,
      concept: pick.label,
      role: 'suffered',
      rate,
      needsReview,
    });
  });
  return { rows, unresolved };
}

// ─────────────────────────────────────────────────────────────
// AIU
// ─────────────────────────────────────────────────────────────

export interface DraftAiuContext {
  /** ¿El documento ya está en operación AIU (`'09'`)? */
  isAiu: boolean;
  /** Valores actuales de `aiu.administracion|imprevistos|utilidad` (texto `'10.00'`). */
  current: { administracion: unknown; imprevistos: unknown; utilidad: unknown };
  /** Valor actual de `aiu_contract_object`. */
  currentContractObject: unknown;
}

export interface DraftAiuPatch {
  /** Para `patchValue`: `{ aiu: { administracion: '10.00', … }, aiu_contract_object }`. */
  patch: Record<string, unknown>;
  /** Rutas escritas: `aiu.administracion`, …, `aiu_contract_object`. */
  aiPaths: string[];
  /** Rutas a revisar (confianza baja). */
  pendingPaths: string[];
  unresolved: string[];
}

const AIU_COMPONENT_KEYS = ['administracion', 'imprevistos', 'utilidad'] as const;

/** Componente del control ⇒ campo del borrador. */
const AIU_DRAFT_FIELD = {
  administracion: 'administracion_percent',
  imprevistos: 'imprevistos_percent',
  utilidad: 'utilidad_percent',
} as const;

/**
 * Reparto AIU leído ⇒ copia de trabajo del AIU del documento.
 *
 * - Sólo con el documento YA en operación AIU: cambiar la operación cambia la
 *   base gravable y el perfil que aplica, y eso lo decide el operador. Si no
 *   lo está, lo leído se cuenta en `unresolved`.
 * - Sólo llena porcentajes VACÍOS: los que vienen del perfil no se pisan; si
 *   el documento dice otra cosa, se avisa.
 * - Porcentaje en el formato del control (`'10.00'`, dos decimales).
 */
export function draftAiuPatch(
  aiu: InvoiceDraftAiu | null | undefined,
  ctx: DraftAiuContext,
): DraftAiuPatch {
  const empty: DraftAiuPatch = { patch: {}, aiPaths: [], pendingPaths: [], unresolved: [] };
  if (!aiu) return empty;
  const read: Partial<Record<(typeof AIU_COMPONENT_KEYS)[number], number>> = {};
  for (const key of AIU_COMPONENT_KEYS) {
    const field = aiu[AIU_DRAFT_FIELD[key]];
    if (hasDraftValue(field) && Number(field.value) >= 0 && Number(field.value) <= 100) {
      read[key] = Math.round(Number(field.value) * 100) / 100;
    }
  }
  const contract = hasDraftValue(aiu.contract_object) ? text(aiu.contract_object.value) : '';
  const summary = AIU_COMPONENT_KEYS.filter((key) => read[key] !== undefined)
    .map((key) => `${key[0].toUpperCase()} ${formatPercent(read[key] as number)}`)
    .join(', ');
  if (!summary && !contract) return empty;

  if (!ctx.isAiu) {
    return {
      ...empty,
      unresolved: [
        `Los documentos traen AIU${summary ? ` (${summary})` : ''}: elige la operación AIU (09) para aplicarlo.`,
      ],
    };
  }

  const out: DraftAiuPatch = { patch: {}, aiPaths: [], pendingPaths: [], unresolved: [] };
  const aiuPatch: Record<string, string> = {};
  for (const key of AIU_COMPONENT_KEYS) {
    const value = read[key];
    if (value === undefined) continue;
    const current = text(ctx.current[key]);
    const formatted = value.toFixed(2);
    if (!current) {
      aiuPatch[key] = formatted;
      out.aiPaths.push(`aiu.${key}`);
      if (isLowConfidence(aiu[AIU_DRAFT_FIELD[key]])) out.pendingPaths.push(`aiu.${key}`);
    } else if (Number(current) !== value) {
      out.unresolved.push(
        `AIU ${key}: el documento dice ${formatPercent(value)} y el documento en curso trae ${formatPercent(Number(current))}; se dejó el actual.`,
      );
    }
  }
  if (Object.keys(aiuPatch).length > 0) out.patch['aiu'] = aiuPatch;
  if (contract && !text(ctx.currentContractObject)) {
    out.patch['aiu_contract_object'] = contract;
    out.aiPaths.push('aiu_contract_object');
    if (isLowConfidence(aiu.contract_object)) out.pendingPaths.push('aiu_contract_object');
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Conteo para el aviso «FacturIA completó N campos»
// ─────────────────────────────────────────────────────────────

/**
 * Lo mínimo de un plan (de tienda o de plataforma) que hace falta para contar.
 * Los dos `InvoiceDraftPlan` / `PlatformInvoiceDraftPlan` lo cumplen.
 */
export interface DraftFillSource {
  acquirer: { aiPaths: readonly string[] };
  invoice: { aiPaths: readonly string[] };
  /** Marcas de cabecera y adquiriente (`'ai' | 'pending'`). */
  headerMarks: Readonly<Record<string, string>>;
  lines: readonly { mark: { ai: readonly string[]; pending: readonly string[] } }[];
  withholdings?: readonly { needsReview?: boolean }[];
  aiu?: { aiPaths: readonly string[] } | null;
}

/** Resultado de {@link countDraftFilledFields}. */
export interface DraftFillSummary {
  /** Total de campos escritos por la IA (lo que dice el aviso). */
  filled: number;
  /** De ellos, del adquiriente (`customer_*` / `external_*`). */
  acquirer: number;
  /** Cabecera, pago, divisa, notas y AIU. */
  document: number;
  /** Campos de línea (descripción, cantidad, precio, unidad, descuento, impuestos, producto). */
  lines: number;
  /** Filas de retención escritas (cada una cuenta como un campo). */
  withholdings: number;
  /** Campos marcados «Revisar» (cabecera + filas + retenciones dudosas). */
  review: number;
}

const isAcquirerControl = (path: string): boolean =>
  path.startsWith('customer_') || path.startsWith('external_');

/**
 * Cuenta PURA de lo que el borrador precargó, para «FacturIA completó N
 * campos · revisa los marcados». No mira el formulario: cuenta el plan.
 *
 * `includeAcquirer: false` cuando el adquiriente resultó un cliente YA
 * existente: sus datos salen de la ficha, no de la IA, y no se cuentan (ni sus
 * «Revisar»). Las rutas repetidas cuentan una vez.
 */
export function countDraftFilledFields(
  plan: DraftFillSource,
  options: { includeAcquirer?: boolean } = {},
): DraftFillSummary {
  const includeAcquirer = options.includeAcquirer !== false;
  const acquirer = includeAcquirer
    ? new Set(plan.acquirer.aiPaths.filter(isAcquirerControl)).size
    : 0;
  const document = new Set([
    ...plan.invoice.aiPaths.filter((path) => !isAcquirerControl(path)),
    ...(plan.aiu?.aiPaths ?? []),
  ]).size;
  const lines = plan.lines.reduce((sum, line) => sum + new Set(line.mark.ai).size, 0);
  const withholdings = plan.withholdings?.length ?? 0;
  const headerReview = Object.entries(plan.headerMarks).filter(
    ([path, mark]) => mark === 'pending' && (includeAcquirer || !isAcquirerControl(path)),
  ).length;
  const review =
    headerReview +
    plan.lines.reduce((sum, line) => sum + new Set(line.mark.pending).size, 0) +
    (plan.withholdings ?? []).filter((row) => row.needsReview).length;
  return {
    filled: acquirer + document + lines + withholdings,
    acquirer,
    document,
    lines,
    withholdings,
    review,
  };
}

/**
 * Aviso de FacturIA tras aplicar lo leído. `filled` = campos que escribió
 * (recalculado sin el adquiriente si resultó un cliente existente).
 */
export function facturiaFilledHeadline(filled: number): string {
  const n = Math.max(0, Math.floor(Number(filled) || 0));
  if (n === 0) {
    return 'FacturIA no encontró datos para completar · revisa la factura y complétala a mano';
  }
  return n === 1
    ? 'FacturIA completó 1 campo · revisa los marcados'
    : `FacturIA completó ${n} campos · revisa los marcados`;
}
