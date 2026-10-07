import { createHash } from 'crypto';

export interface PurchaseVatTaxGroupInput {
  tax_type: string;
  tax_rate: number | string;
  taxable_amount: number | string;
  tax_amount: number | string;
}

export interface PurchaseVatContributionSnapshotInput {
  organization_id: number;
  accounting_entity_id: number;
  store_id: number;
  purchase_order_id: number;
  reception_id: number;
  supplier_id: number;
  supplier_tax_id_snapshot?: string | null;
  invoice_number_snapshot?: string | null;
  invoice_issue_date_snapshot?: string | Date | null;
  currency: string;
  net_amount: number | string;
  iva_amount: number | string;
  tax_groups: PurchaseVatTaxGroupInput[];
}

export interface PurchaseVatContributionSnapshot {
  organization_id: number;
  accounting_entity_id: number;
  store_id: number;
  purchase_order_id: number;
  reception_id: number;
  supplier_id: number;
  supplier_tax_id_snapshot: string | null;
  invoice_number_snapshot: string | null;
  invoice_issue_date_snapshot: string | null;
  currency: string;
  net_amount: string;
  iva_amount: string;
  tax_groups_snapshot: Array<{
    tax_type: 'iva';
    tax_rate: number;
    taxable_amount: string;
    tax_amount: string;
  }>;
  source_effect_key: string;
  payload_hash: string;
}

function money(value: number | string, label: string): string {
  const raw = String(value).trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error(`${label} must be a finite amount with at most 2 decimal places`);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be nonnegative and finite`);
  return parsed.toFixed(2);
}

function id(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function normalizedText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function dateOnly(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('invoice_issue_date_snapshot must be a valid date-only value');
    return value.toISOString().slice(0, 10);
  }
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('invoice_issue_date_snapshot must be YYYY-MM-DD');
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error('invoice_issue_date_snapshot must be a valid date-only value');
  }
  return normalized;
}

/** Build a deterministic, non-persisting snapshot for deductible purchase IVA. */
export function buildPurchaseVatContributionSnapshot(
  input: PurchaseVatContributionSnapshotInput,
): PurchaseVatContributionSnapshot {
  const organization_id = id(input.organization_id, 'organization_id');
  const accounting_entity_id = id(input.accounting_entity_id, 'accounting_entity_id');
  const store_id = id(input.store_id, 'store_id');
  const purchase_order_id = id(input.purchase_order_id, 'purchase_order_id');
  const reception_id = id(input.reception_id, 'reception_id');
  const supplier_id = id(input.supplier_id, 'supplier_id');
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency !== 'COP') throw new Error('currency must be COP');
  const net_amount = money(input.net_amount, 'net_amount');
  const iva_amount = money(input.iva_amount, 'iva_amount');
  if (!Array.isArray(input.tax_groups)) throw new Error('tax_groups must be an array');
  const tax_groups_snapshot = input.tax_groups.map((group) => {
    if (group.tax_type !== 'iva') throw new Error('tax_groups may contain only IVA');
    const rateRaw = String(group.tax_rate).trim();
    if (!/^\d+(?:\.\d{1,5})?$/.test(rateRaw)) throw new Error('tax_rate must be finite with at most 5 decimal places');
    const tax_rate = Number(rateRaw);
    if (!Number.isFinite(tax_rate) || tax_rate < 0 || tax_rate > 100) throw new Error('tax_rate must be between 0 and 100');
    return {
      tax_type: 'iva' as const,
      tax_rate,
      taxable_amount: money(group.taxable_amount, 'taxable_amount'),
      tax_amount: money(group.tax_amount, 'tax_amount'),
    };
  }).sort((a, b) => a.tax_type.localeCompare(b.tax_type) || a.tax_rate - b.tax_rate ||
    a.taxable_amount.localeCompare(b.taxable_amount) || a.tax_amount.localeCompare(b.tax_amount));
  const groupedTaxCents = tax_groups_snapshot.reduce((sum, group) => sum + Math.round(Number(group.tax_amount) * 100), 0);
  if (groupedTaxCents !== Math.round(Number(iva_amount) * 100)) throw new Error('sum of tax group tax_amount must equal iva_amount');

  const snapshot = {
    organization_id, accounting_entity_id, store_id, purchase_order_id, reception_id, supplier_id,
    supplier_tax_id_snapshot: normalizedText(input.supplier_tax_id_snapshot),
    invoice_number_snapshot: normalizedText(input.invoice_number_snapshot),
    invoice_issue_date_snapshot: dateOnly(input.invoice_issue_date_snapshot),
    currency, net_amount, iva_amount, tax_groups_snapshot,
  };
  const payload_hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return { ...snapshot, source_effect_key: `po:${purchase_order_id}:deductible-iva:v1`, payload_hash };
}
