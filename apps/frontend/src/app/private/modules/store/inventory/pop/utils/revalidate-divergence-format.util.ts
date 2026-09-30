import { InvoiceRevalidateDivergence } from '../interfaces/invoice-scanner.interface';

/**
 * Presentación legible de las divergencias de la revalidación IA: etiqueta del
 * campo en español, valor formateado según su naturaleza (moneda, porcentaje,
 * lista de impuestos) y filtro del ruido (filas donde Consolidado, Documento y
 * Revalidado son iguales). Lógica pura: la moneda llega como función.
 */

export type DivergenceMoneyFormatter = (amount: number) => string;

export interface DivergenceRow {
  /** Índice 0-based de la línea, null si es de cabecera. */
  lineIndex: number | null;
  fieldLabel: string;
  consolidated: string;
  document: string;
  revalidated: string;
  /** Revalidado difiere de Consolidado (para el resaltado). */
  differs: boolean;
  reason: string;
  /** La razón venía como `user_override:`; se muestra como decisión del usuario. */
  isUserDecision: boolean;
}

export interface DivergenceView {
  rows: DivergenceRow[];
  /** Filas descartadas por ser iguales en los tres valores. */
  hiddenCount: number;
}

const NUMBER_TOLERANCE = 0.005;
const EMPTY = '—';
const USER_OVERRIDE_PREFIX = 'user_override:';

const MONEY_FIELDS = new Set([
  'total',
  'subtotal',
  'unit_price',
  'unit_price_gross',
  'unit_cost_net',
  'discount_amount',
  'discount_amount_printed',
  'early_payment_discount',
  'tax_amount',
  'amount',
  'amount_override',
  'fixed_amount_per_unit',
  'shipping',
  'shipping_amount',
  'freight',
  'freight_amount',
]);

const PERCENT_FIELDS = new Set(['discount_percentage', 'discount_percent']);

/** `tax_rate` legado de la línea es FRACCIÓN (0.19), se muestra como 19 %. */
const FRACTION_PERCENT_FIELDS = new Set(['tax_rate']);

const FIELD_LABELS: Record<string, string> = {
  taxes: 'Impuestos',
  tax_amount: 'Impuestos',
  tax_rate: 'Tasa de impuesto',
  quantity: 'Cantidad',
  unit_price: 'Precio unitario',
  unit_price_gross: 'Precio unitario impreso',
  unit_cost_net: 'Costo unitario neto',
  subtotal: 'Subtotal',
  discount_amount: 'Descuento ($)',
  discount_amount_printed: 'Descuento impreso ($)',
  discount_percent: 'Descuento (%)',
  discount_percentage: 'Descuento (%)',
  early_payment_discount: 'Descuento por pronto pago',
  description: 'Descripción',
  name: 'Descripción',
  sku: 'SKU',
  sku_if_visible: 'SKU',
  supplier: 'Proveedor',
  supplier_name: 'Proveedor',
  tax_id: 'NIT',
  invoice_number: 'N.º factura',
  invoice_date: 'Fecha',
  date: 'Fecha',
  payment_terms: 'Condiciones de pago',
  prices_include_tax: 'Precios incluyen impuesto',
  presentation: 'Presentación',
  pack_size: 'Unidades por empaque',
  uom_hint: 'Unidad de medida',
  shipping: 'Flete',
  shipping_amount: 'Flete',
  freight: 'Flete',
  freight_amount: 'Flete',
};

function normalizeKey(field: string): string {
  const key = (field ?? '').trim().toLowerCase();
  const dot = key.lastIndexOf('.');
  return dot >= 0 ? key.slice(dot + 1) : key;
}

export function divergenceFieldLabel(field: string, lineIndex: number | null): string {
  const key = normalizeKey(field);
  if (key === 'total') return lineIndex !== null ? 'Total de línea' : 'Total';
  const label = FIELD_LABELS[key];
  if (label) return label;
  const cleaned = key.replace(/_/g, ' ').trim();
  if (!cleaned) return field;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// ---------------------------------------------------------------------------
// Normalización e igualdad
// ---------------------------------------------------------------------------

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function toFinite(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

interface NormalizedTax {
  type: string;
  rate: number | null;
  fixed: number | null;
  amount: number | null;
  inclusive: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeTax(raw: unknown): NormalizedTax | null {
  if (!isRecord(raw)) return null;
  const type = String(raw['type'] ?? raw['tax_type'] ?? '').trim().toLowerCase();
  return {
    type,
    rate: toFinite(raw['rate'] ?? raw['tax_rate']),
    fixed: toFinite(raw['fixed_amount_per_unit']),
    amount: toFinite(raw['amount'] ?? raw['amount_override']),
    inclusive: (raw['inclusive'] ?? raw['is_inclusive']) === true,
  };
}

function isTaxArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0 && v.every((t) => normalizeTax(t) !== null);
}

function taxKey(t: NormalizedTax): string {
  return [t.type, t.rate ?? '', t.fixed ?? '', t.amount ?? '', t.inclusive ? 1 : 0].join('|');
}

function sortedTaxes(v: unknown[]): NormalizedTax[] {
  return v
    .map((t) => normalizeTax(t))
    .filter((t): t is NormalizedTax => t !== null)
    .sort((a, b) => taxKey(a).localeCompare(taxKey(b)));
}

function numbersClose(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= NUMBER_TOLERANCE;
}

function taxesEqual(a: unknown[], b: unknown[]): boolean {
  const sa = sortedTaxes(a);
  const sb = sortedTaxes(b);
  if (sa.length !== sb.length) return false;
  return sa.every((t, i) => {
    const o = sb[i];
    return (
      t.type === o.type &&
      t.inclusive === o.inclusive &&
      numbersClose(t.rate, o.rate) &&
      numbersClose(t.fixed, o.fixed) &&
      numbersClose(t.amount, o.amount)
    );
  });
}

export function divergenceValuesEqual(a: unknown, b: unknown): boolean {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (isTaxArray(a) && isTaxArray(b)) return taxesEqual(a, b);
    if (a.length !== b.length) return false;
    return a.every((x, i) => divergenceValuesEqual(x, b[i]));
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!divergenceValuesEqual(a[k], b[k])) return false;
    }
    return true;
  }
  if (isRecord(a) || isRecord(b)) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = toFinite(a);
    const nb = toFinite(b);
    if (na !== null && nb !== null) return numbersClose(na, nb);
  }
  return String(a).trim() === String(b).trim();
}

// ---------------------------------------------------------------------------
// Formato de valores
// ---------------------------------------------------------------------------

function formatPlainNumber(n: number): string {
  return (Math.round(n * 10000) / 10000).toLocaleString('es-CO', { maximumFractionDigits: 4 });
}

function formatPercent(n: number): string {
  return `${formatPlainNumber(n)} %`;
}

function formatTax(t: NormalizedTax, money: DivergenceMoneyFormatter): string {
  const label = t.type ? t.type.toUpperCase() : 'Impuesto';
  let detail = '';
  if (t.fixed !== null) detail = ` ${money(t.fixed)}/u`;
  else if (t.amount !== null) detail = ` ${money(t.amount)}`;
  else if (t.rate !== null) detail = ` ${formatPercent(t.rate)}`;
  return `${label}${detail}${t.inclusive ? ' (incluido)' : ''}`;
}

function formatGeneric(v: unknown): string {
  if (isEmpty(v)) return EMPTY;
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'number') return formatPlainNumber(v);
  if (Array.isArray(v)) return v.map((x) => formatGeneric(x)).join(' · ');
  if (isRecord(v)) {
    return Object.entries(v)
      .map(([k, val]) => `${divergenceFieldLabel(k, null)}: ${formatGeneric(val)}`)
      .join(', ');
  }
  return String(v);
}

export function formatDivergenceValue(
  field: string,
  value: unknown,
  money: DivergenceMoneyFormatter,
): string {
  if (isEmpty(value)) {
    return Array.isArray(value) && normalizeKey(field) === 'taxes' ? 'Sin impuesto' : EMPTY;
  }
  if (isTaxArray(value)) {
    return sortedTaxesInOriginalOrder(value)
      .map((t) => formatTax(t, money))
      .join(' · ');
  }
  const key = normalizeKey(field);
  const n = toFinite(value);
  if (n !== null && !Array.isArray(value)) {
    if (MONEY_FIELDS.has(key)) return money(n);
    if (PERCENT_FIELDS.has(key)) return formatPercent(n);
    if (FRACTION_PERCENT_FIELDS.has(key)) return formatPercent(n <= 1 ? n * 100 : n);
    if (typeof value === 'number') return formatPlainNumber(n);
  }
  return formatGeneric(value);
}

function sortedTaxesInOriginalOrder(v: unknown[]): NormalizedTax[] {
  return v.map((t) => normalizeTax(t)).filter((t): t is NormalizedTax => t !== null);
}

// ---------------------------------------------------------------------------
// Vista completa
// ---------------------------------------------------------------------------

export function buildDivergenceView(
  divergences: readonly InvoiceRevalidateDivergence[],
  money: DivergenceMoneyFormatter,
): DivergenceView {
  const rows: DivergenceRow[] = [];
  let hiddenCount = 0;
  for (const d of divergences) {
    const rawReason = d.reason ?? '';
    const isUserDecision = rawReason.startsWith(USER_OVERRIDE_PREFIX);
    const allEqual =
      divergenceValuesEqual(d.consolidated_value, d.document_value) &&
      divergenceValuesEqual(d.consolidated_value, d.revalidated_value);
    if (allEqual && !isUserDecision) {
      hiddenCount++;
      continue;
    }
    rows.push({
      lineIndex: d.line_index,
      fieldLabel: divergenceFieldLabel(d.field, d.line_index),
      consolidated: formatDivergenceValue(d.field, d.consolidated_value, money),
      document: formatDivergenceValue(d.field, d.document_value, money),
      revalidated: formatDivergenceValue(d.field, d.revalidated_value, money),
      differs: !divergenceValuesEqual(d.consolidated_value, d.revalidated_value),
      reason: isUserDecision ? rawReason.slice(USER_OVERRIDE_PREFIX.length).trim() : rawReason,
      isUserDecision,
    });
  }
  return { rows, hiddenCount };
}
