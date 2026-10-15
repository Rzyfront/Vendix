/**
 * Borrador IA de «Nueva factura» de PLATAFORMA → controles del formulario.
 *
 * Adaptador PURO sobre `invoice-draft-mapping` (el de la tienda): las reglas de
 * lectura —documento, DV, fechas, plazo, medio de pago, descuento % → importe,
 * impuesto por tarifa, pendientes, etiquetas— son las mismas y se reutilizan
 * tal cual. Lo único que cambia aquí es el VOCABULARIO de la pantalla:
 *
 *  · el adquiriente vive en `external_*` (no en `customer_*`);
 *  · persona `'1'`/`'2'` (no `JURIDICA`/`NATURAL`);
 *  · régimen `'48'`/`'49'` (no `COMUN`/`SIMPLIFICADO`…);
 *  · la divisa es `declare_foreign` + `foreign_currency_code`;
 *  · los medios de pago y los tipos de documento son un subconjunto;
 *  · las líneas no tienen catálogo de productos (todas son ítem libre).
 *
 * Nada de esto emite ni crea: al emitir, el backend registra al cliente
 * externo como cliente de la plataforma.
 */
import type { TaxOption, TaxSelection } from '../../../../../../shared/components/tax-selector';
import type {
  InvoiceFieldMark,
  LineasRowMark,
} from '../../../../../../shared/components/invoice-sections/invoice-section-marks';
import {
  isFiscalResponsibility,
  normalizeFiscalResponsibilityCode,
} from '../../../../../../shared/constants/fiscal-responsibilities.constants';
import { computeNitDv } from '../../../../../../shared/utils/nit.util';
import type {
  DraftField,
  InvoiceDraftAcquirer,
  InvoiceDraftExistingAcquirer,
  InvoiceDraftScanResult,
} from '../../../../store/invoicing/interfaces/invoice-draft-scan.interface';
import {
  draftLinesToLineInputs,
  draftNitDvMismatch,
  draftPathLabel,
  draftPendingPaths,
  draftToAcquirerPatch,
  draftToInvoicePatch,
  hasDraftValue,
} from '../../../../store/invoicing/utils/invoice-draft-mapping';

const text = (value: unknown): string =>
  value == null ? '' : String(value).trim();

// ─────────────────────────────────────────────────────────────
// Vocabulario de la pantalla de plataforma
// ─────────────────────────────────────────────────────────────

/** Tipos de documento que ofrece el selector de plataforma (códigos DIAN). */
export const PLATFORM_DOCUMENT_TYPE_CODES: readonly string[] = ['31', '13', '22', '41'];

/** Medios de pago que ofrece el selector de plataforma (códigos DIAN). */
export const PLATFORM_PAYMENT_MEANS_CODES: readonly string[] = ['10', '42', '48', '49', '1'];

/**
 * Control de la tienda (nombre que devuelven las funciones compartidas) →
 * control de la plataforma. Lo que no esté aquí se llama igual en las dos.
 */
export const PLATFORM_CONTROL_BY_STORE_CONTROL: Readonly<Record<string, string>> = {
  customer_document_type: 'external_document_type',
  customer_tax_id: 'external_tax_id',
  customer_verification_digit: 'external_tax_id_dv',
  customer_person_type: 'external_person_type',
  customer_name: 'external_legal_name',
  customer_email: 'external_email',
  customer_phone: 'external_phone',
  customer_address: 'external_address_line',
  customer_municipality_code: 'external_city_code',
  customer_tax_regime: 'external_tax_regime_code',
  customer_fiscal_responsibilities: 'external_fiscal_responsibilities',
  use_foreign_currency: 'declare_foreign',
  foreign_currency: 'foreign_currency_code',
};

/** Ruta de pantalla de la tienda → la de plataforma (`lines.N.*` pasa igual). */
export function toPlatformControl(path: string): string {
  return PLATFORM_CONTROL_BY_STORE_CONTROL[path] ?? path;
}

const stripAccents = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Régimen leído → `'48'` (responsable de IVA) / `'49'` (no responsable) o `''`
 * si no se reconoce. Acepta el código DIAN, el vocabulario de la tienda y las
 * frases habituales del RUT. «Régimen especial» no se adivina.
 */
export function platformTaxRegimeCode(raw: unknown): '48' | '49' | '' {
  const value = stripAccents(text(raw).toUpperCase()).replace(/[\s-]+/g, '_');
  if (!value) return '';
  if (value === '48' || value === 'O_48') return '48';
  if (value === '49' || value === 'O_49' || value === 'R_99_PN') return '49';
  if (/^NO_(RESPONSABLE|APLICA)/.test(value) || value.includes('SIMPLIFICADO')) {
    return '49';
  }
  if (
    value === 'COMUN' ||
    value.includes('RESPONSABLE') ||
    value.includes('GRAN_CONTRIBUYENTE') ||
    value.includes('AUTORRETENEDOR') ||
    value.includes('REGIMEN_COMUN')
  ) {
    return '48';
  }
  return '';
}

/** Régimen deducido de las responsabilidades del RUT (O-48 / O-49 / R-99-PN). */
export function platformTaxRegimeFromResponsibilities(
  codes: readonly string[],
): '48' | '49' | '' {
  if (codes.includes('O-48')) return '48';
  if (codes.includes('O-49') || codes.includes('R-99-PN')) return '49';
  return '';
}

/**
 * Código de medio de pago (de `draftPaymentMeansCode`) → uno que el selector
 * de plataforma ofrezca, o `null`. Las transferencias (45/47/30) caen en la
 * única de la lista, «Transferencia Bancaria» (42).
 */
export function platformPaymentMeansCode(code: unknown): string | null {
  const value = text(code);
  if (!value) return null;
  if (PLATFORM_PAYMENT_MEANS_CODES.includes(value)) return value;
  if (value === '45' || value === '47' || value === '30') return '42';
  return null;
}

// ─────────────────────────────────────────────────────────────
// Adquiriente
// ─────────────────────────────────────────────────────────────

export interface PlatformDraftAcquirerPatch {
  /** Controles `external_*` para `patchValue`: sólo lo que la IA trajo. */
  patch: Record<string, unknown>;
  /** Controles escritos con un valor leído (marca «IA»). */
  aiPaths: string[];
  /** Controles que hay que revisar porque lo leído no cabe en la pantalla. */
  pendingPaths: string[];
  /** Número del documento sin DV, o `''`. */
  documentDigits: string;
  /** Lo leído que la pantalla no pudo representar, en palabras. */
  unresolved: string[];
}

/**
 * Adquiriente leído ⇒ controles `external_*`.
 *
 * Compone `draftToAcquirerPatch` y traduce: tipo de documento sólo si el
 * selector lo ofrece (o la IA ya lo trajo como código DIAN), persona
 * `'1'`/`'2'`, municipio DANE con su departamento (los dos primeros dígitos
 * del código), régimen desde lo leído o, si falta, desde las responsabilidades.
 * El DV se DERIVA del número (módulo 11) y no se marca.
 */
export function draftToPlatformAcquirerPatch(
  acquirer: InvoiceDraftAcquirer,
): PlatformDraftAcquirerPatch {
  const base = draftToAcquirerPatch(acquirer);
  const src = base.patch;
  const patch: Record<string, unknown> = {};
  const aiPaths: string[] = [];
  const pendingPaths: string[] = [];
  const unresolved: string[] = [];
  const wasRead = (control: string): boolean => base.aiPaths.includes(control);
  const put = (storeControl: string, value: unknown): void => {
    const control = toPlatformControl(storeControl);
    patch[control] = value;
    if (wasRead(storeControl)) aiPaths.push(control);
  };

  // Tipo de documento: el compartido devuelve el código DIAN de la sigla; la
  // IA de plataforma puede traer directamente el código ('31').
  let docCode = text(src['customer_document_type']);
  if (!docCode && hasDraftValue(acquirer.document_type)) {
    const raw = text(acquirer.document_type.value);
    if (PLATFORM_DOCUMENT_TYPE_CODES.includes(raw)) {
      docCode = raw;
      patch['external_document_type'] = raw;
      aiPaths.push('external_document_type');
    }
  } else if (docCode) {
    if (PLATFORM_DOCUMENT_TYPE_CODES.includes(docCode)) {
      put('customer_document_type', docCode);
    } else {
      pendingPaths.push('external_document_type');
      unresolved.push(
        'El tipo de documento leído no se puede facturar desde la plataforma: elígelo a mano.',
      );
      docCode = '';
    }
  }

  const digits = base.documentDigits;
  if (digits) {
    put('customer_tax_id', digits);
    const isNit = docCode === '31' || (!docCode && base.documentSigla === 'NIT');
    patch['external_tax_id_dv'] = isNit ? (computeNitDv(digits) ?? '') : '';
  }

  const person = text(src['customer_person_type']);
  if (person === 'NATURAL' || person === 'JURIDICA') {
    patch['external_person_type'] = person === 'NATURAL' ? '2' : '1';
    if (wasRead('customer_person_type')) aiPaths.push('external_person_type');
  }

  for (const control of [
    'customer_name',
    'customer_email',
    'customer_phone',
    'customer_address',
  ]) {
    if (control in src) put(control, src[control]);
  }

  const municipality = text(src['customer_municipality_code']);
  if (/^\d{5}$/.test(municipality)) {
    put('customer_municipality_code', municipality);
    patch['external_city'] = text(src['customer_city_name']);
    patch['external_department_code'] = municipality.slice(0, 2);
  }

  // Responsabilidades: el compartido ya normaliza y filtra contra el catálogo.
  // Se repite el filtro sobre lo leído para no depender de que el patch las
  // traiga cuando vienen en otra forma ('o13').
  let responsibilities: string[] = Array.isArray(src['customer_fiscal_responsibilities'])
    ? [...(src['customer_fiscal_responsibilities'] as string[])]
    : [];
  if (responsibilities.length === 0 && hasDraftValue(acquirer.fiscal_responsibilities)) {
    responsibilities = Array.from(
      new Set(
        acquirer.fiscal_responsibilities.value
          .map((code) => normalizeFiscalResponsibilityCode(code))
          .filter((code) => isFiscalResponsibility(code)),
      ),
    );
  }
  if (responsibilities.length > 0) {
    patch['external_fiscal_responsibilities'] = responsibilities;
    aiPaths.push('external_fiscal_responsibilities');
  }

  // Régimen: el compartido sólo acepta el vocabulario de la tienda; aquí se
  // lee el valor crudo y, si no dice nada útil, las responsabilidades.
  const regime =
    (hasDraftValue(acquirer.tax_regime)
      ? platformTaxRegimeCode(acquirer.tax_regime.value)
      : '') || platformTaxRegimeFromResponsibilities(responsibilities);
  if (regime) {
    patch['external_tax_regime_code'] = regime;
    aiPaths.push('external_tax_regime_code');
  } else if (hasDraftValue(acquirer.tax_regime)) {
    pendingPaths.push('external_tax_regime_code');
  }

  return { patch, aiPaths, pendingPaths, documentDigits: digits, unresolved };
}

// ─────────────────────────────────────────────────────────────
// Cabecera y pago
// ─────────────────────────────────────────────────────────────

export interface PlatformDraftInvoiceContext {
  today: string;
  currentNotes: string;
  notesLimit: number;
  foreignCurrencies: readonly string[];
}

export interface PlatformDraftInvoicePatch {
  /** `issue_date`, `payment_form`, `payment_means_code`, `notes`, divisa. */
  patch: Record<string, unknown>;
  /** Vencimiento a escribir DESPUÉS de la forma de pago; `null` = no tocar. */
  dueDate: string | null;
  aiPaths: string[];
  unresolved: string[];
}

/**
 * Cabecera y pago leídos ⇒ controles de «Documento» de plataforma. Las reglas
 * (contado/crédito, plazo → vencimiento, referencia dentro de notas, divisa)
 * son las de `draftToInvoicePatch`; aquí sólo se renombran los controles de
 * divisa y se acota el medio de pago a los que ofrece la plataforma.
 */
export function draftToPlatformInvoicePatch(
  result: Pick<InvoiceDraftScanResult, 'invoice' | 'payment'>,
  ctx: PlatformDraftInvoiceContext,
): PlatformDraftInvoicePatch {
  const base = draftToInvoicePatch(result, ctx);
  const patch: Record<string, unknown> = {};
  const aiPaths: string[] = [];
  const unresolved = [...base.unresolved];

  for (const [control, value] of Object.entries(base.patch)) {
    if (control === 'payment_means_code') {
      const code = platformPaymentMeansCode(value);
      if (code) {
        patch['payment_means_code'] = code;
      } else {
        unresolved.push(
          'El medio de pago leído no está entre los de la plataforma: elígelo a mano.',
        );
      }
      continue;
    }
    patch[toPlatformControl(control)] = value;
  }
  for (const path of base.aiPaths) {
    const control = toPlatformControl(path);
    if (control === 'payment_means_code' && !('payment_means_code' in patch)) continue;
    aiPaths.push(control);
  }

  return { patch, dueDate: base.dueDate, aiPaths, unresolved };
}

// ─────────────────────────────────────────────────────────────
// Líneas
// ─────────────────────────────────────────────────────────────

/** Valores de UNA fila de `items` de plataforma (sin catálogo de productos). */
export interface PlatformDraftLineValue {
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  taxes: TaxSelection[];
}

export interface PlatformDraftPlanLine {
  value: PlatformDraftLineValue;
  mark: LineasRowMark;
}

/** ¿La fila ya tiene trabajo del operador? Descripción o precio. */
export function isCapturedPlatformLine(item: {
  description?: unknown;
  unit_price?: unknown;
}): boolean {
  return (
    text(item?.description).length > 0 || Number(item?.unit_price ?? 0) > 0
  );
}

/**
 * Quita UN campo de la marca de una fila (el operador lo editó). `null` si la
 * fila se queda sin nada que señalar.
 */
export function dropPlatformRowMarkField(
  mark: LineasRowMark,
  field: string,
): LineasRowMark | null {
  const next: LineasRowMark = {
    ai: mark.ai.filter((entry) => entry !== field),
    pending: mark.pending.filter((entry) => entry !== field),
    note: mark.note ?? null,
  };
  return next.ai.length === 0 && next.pending.length === 0 ? null : next;
}

/**
 * Notas de fila que sólo tienen sentido con catálogo de productos: en la
 * plataforma TODA línea es ítem libre, así que decirlo en cada fila es ruido.
 */
const CATALOG_ONLY_NOTES: ReadonlySet<string> = new Set([
  'Ítem libre: no está en el catálogo',
  'Producto del catálogo por confirmar',
]);

function platformRowNote(note: string | null): string | null {
  if (!note) return null;
  const parts = note
    .split(' · ')
    .map((part) => part.trim())
    .filter((part) => part && !CATALOG_ONLY_NOTES.has(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ─────────────────────────────────────────────────────────────
// Plan completo
// ─────────────────────────────────────────────────────────────

export interface PlatformInvoiceDraftNotice {
  documents: number;
  pending: string[];
  noteApplied: string | null;
  extractionNotes: string | null;
  unresolved: string[];
  totalsInconsistent: boolean;
  documentTotal: number | null;
  /** Cómo quedó el adquiriente; lo completa la página al resolverlo. */
  acquirer: string | null;
}

export interface PlatformInvoiceDraftPlanContext extends PlatformDraftInvoiceContext {
  taxes: readonly TaxOption[];
  currentItems: readonly { description?: unknown; unit_price?: unknown }[];
  maxLines: number;
  descriptionLimit: number;
}

export interface PlatformInvoiceDraftPlan {
  acquirer: PlatformDraftAcquirerPatch;
  /** `true` si el borrador trae algo del adquiriente (documento o nombre). */
  hasAcquirer: boolean;
  /** Destinatario que el backend ya reconoció; `null` si es nuevo. */
  existingAcquirer: InvoiceDraftExistingAcquirer | null;
  invoice: PlatformDraftInvoicePatch;
  /** Marcas por control (`external_*` y cabecera); `pending` gana a `ai`. */
  headerMarks: Record<string, InvoiceFieldMark>;
  /** `true` ⇒ las filas actuales no tienen trabajo y se REEMPLAZAN. */
  replaceLines: boolean;
  lines: PlatformDraftPlanLine[];
  droppedLines: number;
  notice: PlatformInvoiceDraftNotice;
}

/**
 * Borrador IA ⇒ todo lo que la página de plataforma escribe, sin tocar el
 * formulario. Mismo criterio que el plan de la tienda: si no hay líneas con
 * trabajo se reemplazan, si las hay se agregan al final hasta el tope; lo que
 * escribe la IA es «IA», lo dudoso es «Revisar» y gana.
 */
export function planPlatformInvoiceDraft(
  result: InvoiceDraftScanResult,
  ctx: PlatformInvoiceDraftPlanContext,
): PlatformInvoiceDraftPlan {
  const acquirer = draftToPlatformAcquirerPatch(result.acquirer);
  const invoice = draftToPlatformInvoicePatch(result, ctx);
  const pendingPaths = draftPendingPaths(result, { today: ctx.today });

  const headerMarks: Record<string, InvoiceFieldMark> = {};
  for (const path of [...acquirer.aiPaths, ...invoice.aiPaths]) {
    headerMarks[path] = 'ai';
  }
  for (const path of [
    ...pendingPaths.filter((p) => !p.startsWith('lines.')).map(toPlatformControl),
    ...acquirer.pendingPaths,
  ]) {
    headerMarks[path] = 'pending';
  }

  // Pendientes de fila que señaló el backend (`lines.N.<control>` / `lines.N`).
  const rowPending = new Map<number, Set<string>>();
  const wholeRow = new Set<number>();
  for (const path of pendingPaths) {
    const match = /^lines\.(\d+)(?:\.(\w+))?$/.exec(path);
    if (!match) continue;
    const index = Number(match[1]);
    if (!match[2]) {
      wholeRow.add(index);
      continue;
    }
    if (match[2] === 'product') continue;
    const set = rowPending.get(index) ?? new Set<string>();
    set.add(match[2]);
    rowPending.set(index, set);
  }

  const replaceLines = !ctx.currentItems.some((item) => isCapturedPlatformLine(item));
  const kept = replaceLines
    ? 0
    : ctx.currentItems.filter((item) => isCapturedPlatformLine(item)).length;
  const room = Math.max(0, ctx.maxLines - kept);
  const inputs = draftLinesToLineInputs(result.lines ?? [], ctx.taxes);
  const lines: PlatformDraftPlanLine[] = inputs.slice(0, room).map((input) => {
    const pending = new Set<string>(
      input.pendingFields.filter((field) => field !== 'product'),
    );
    for (const field of rowPending.get(input.draftIndex) ?? []) pending.add(field);
    const notes = [
      platformRowNote(input.note),
      wholeRow.has(input.draftIndex) ? 'Revisa la línea completa' : null,
    ].filter((note): note is string => !!note);
    return {
      value: {
        description: input.value.description.slice(0, ctx.descriptionLimit),
        quantity: input.value.quantity,
        unit_price: input.value.unit_price,
        discount_amount: input.value.discount_amount,
        taxes: input.value.taxes,
      },
      mark: {
        ai: input.aiFields.filter((field) => field !== 'product'),
        pending: [...pending],
        note: notes.length > 0 ? notes.join(' · ') : null,
      },
    };
  });
  const droppedLines = inputs.length - lines.length;

  const pending = Array.from(
    new Set(
      [...(result.missing_fields ?? []), ...(result.requires_review ?? [])]
        .filter((path) => !/^lines\.\d+\.(product_id|product_variant_id|sku|match_status)$/.test(path))
        .map((path) => draftPathLabel(path)),
    ),
  );
  const unresolved = [...invoice.unresolved, ...acquirer.unresolved];
  if (draftNitDvMismatch(result.acquirer)) {
    unresolved.push(
      'El dígito de verificación leído no corresponde al NIT: revisa el número del documento.',
    );
  }
  if (droppedLines > 0) {
    unresolved.push(
      `${droppedLines} línea(s) del documento no se cargaron: la factura admite hasta ${ctx.maxLines}.`,
    );
  }

  const existing = result.acquirer?.existing_acquirer ?? null;
  const existingAcquirer =
    existing && Number(existing.tenant_id) > 0 && existing.kind ? existing : null;

  return {
    acquirer,
    hasAcquirer:
      !!acquirer.documentDigits || hasDraftValue(result.acquirer.name) || !!existingAcquirer,
    existingAcquirer,
    invoice,
    headerMarks,
    replaceLines,
    lines,
    droppedLines,
    notice: {
      documents: Math.max(1, Number(result.documents_scanned) || 1),
      pending,
      noteApplied: result.note_applied?.trim() || null,
      extractionNotes: result.extraction_notes?.trim() || null,
      unresolved,
      totalsInconsistent: result.totals?.consistent === false,
      documentTotal:
        typeof result.totals?.total === 'number' ? result.totals.total : null,
      acquirer: null,
    },
  };
}

/** ¿El campo leído es débil (vacío o con confianza baja)? */
export function isWeakDraftField(
  field: DraftField<unknown> | null | undefined,
  threshold: number,
): boolean {
  return !hasDraftValue(field) || (field?.confidence ?? 0) < threshold;
}

// ─────────────────────────────────────────────────────────────
// Faltantes para emitir (adquiriente)
// ─────────────────────────────────────────────────────────────

/** Campo del adquiriente que falta (o está mal) para emitir. */
export interface PlatformAcquirerMissingField {
  /** Nombre del control `external_*`. */
  field: string;
  label: string;
  reason: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Qué le falta al adquiriente PARA EMITIR, sin red. Es la ÚNICA definición:
 * la usa la lista junto al botón, el borde rojo y el «Requerido para emitir»
 * de cada campo, y el bloqueo de «Emitir».
 *
 * Alineado con la tienda (`missingAcquirerEmissionFields`): con documento
 * declarado hacen falta tipo, nombre, dirección fiscal y municipio DANE. La
 * plataforma, que siempre factura a un adquiriente identificado, exige además
 * número, tipo de persona, régimen y el correo al que se envía la factura.
 */
export function platformAcquirerMissing(
  raw: Record<string, unknown>,
): PlatformAcquirerMissingField[] {
  const value = (key: string): string => text(raw[key]);
  const missing: PlatformAcquirerMissingField[] = [];
  const add = (field: string, label: string, reason: string): void => {
    missing.push({ field, label, reason });
  };

  if (!value('external_document_type')) {
    add('external_document_type', 'Tipo de documento', 'Elige NIT, cédula u otro tipo.');
  }
  const taxId = value('external_tax_id');
  if (!taxId) {
    add('external_tax_id', 'Número de documento', 'La DIAN rechaza el documento sin identificación del adquiriente.');
  } else if (value('external_document_type') === '31' && !value('external_tax_id_dv')) {
    add('external_tax_id_dv', 'Dígito de verificación', 'El NIT necesita su DV.');
  }
  if (!value('external_legal_name')) {
    add('external_legal_name', 'Razón social o nombre', 'El adquiriente necesita nombre o razón social.');
  }
  if (!value('external_person_type')) {
    add('external_person_type', 'Tipo de persona', 'Indica si es persona jurídica o natural.');
  }
  if (!value('external_tax_regime_code')) {
    add('external_tax_regime_code', 'Régimen tributario', 'Indica si es responsable de IVA.');
  }
  const email = value('external_email');
  if (!email) {
    add('external_email', 'Correo para el envío', 'Es la dirección a la que se entrega la factura electrónica.');
  } else if (!EMAIL_PATTERN.test(email)) {
    add('external_email', 'Correo para el envío', 'El correo no tiene un formato válido.');
  }
  if (!value('external_address_line')) {
    add('external_address_line', 'Dirección fiscal', 'Un adquiriente con documento necesita dirección fiscal.');
  }
  if (!/^\d{5}$/.test(value('external_city_code'))) {
    add('external_city_code', 'Municipio (DANE)', 'Búscalo por nombre y selecciónalo: sin ese código la DIAN rechaza el documento.');
  }
  return missing;
}
