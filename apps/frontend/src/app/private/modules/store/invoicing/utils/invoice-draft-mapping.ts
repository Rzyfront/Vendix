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
} from '../components/invoice-create/invoice-dian-catalogs';
import type {
  DraftField,
  InvoiceDraftAcquirer,
  InvoiceDraftLine,
  InvoiceDraftScanResult,
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
 * - COP no toca nada; otra divisa sólo si el selector la ofrece.
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
}

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
};

const PAYMENT_PATH_TO_CONTROL: Readonly<Record<string, string>> = {
  payment_form: 'payment_form',
  payment_term_days: 'due_date',
  payment_method_hint: 'payment_means_code',
};

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
    const field = result.invoice[key as keyof typeof result.invoice];
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
  return path;
}
