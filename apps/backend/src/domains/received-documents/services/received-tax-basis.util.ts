import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

export type ReceivedTaxDocumentType = 'invoice' | 'credit_note' | 'debit_note' | 'non_electronic';
export type ReceivedTaxRepresentation = 'header' | 'item' | 'none';

export interface ReceivedTaxBasisInput {
  document_id: number;
  document_type: ReceivedTaxDocumentType;
  tax_amount: Prisma.Decimal | number | string;
  tax_rows: Array<{
    id: number;
    item_id: number | null;
    tax_type: string | null;
    scheme_code: string | null;
    rate: Prisma.Decimal | number | string | null;
    base_amount: Prisma.Decimal | number | string;
    amount: Prisma.Decimal | number | string;
    metadata?: unknown;
  }>;
}

export interface ReceivedTaxBasisGroup {
  tax_type: string | null;
  scheme_code: string | null;
  rate: string | null;
  basis_qualifier: {
    tax_basis_type: 'monetary' | 'unit';
    base_unit_code: string | null;
    per_unit_amount: string | null;
  };
  base_quantity: string | null;
  base_amount: string;
  tax_amount: string;
  evidence_tax_ids: number[];
}

export interface ReceivedTaxBasisBlocker {
  code: string;
  evidence_tax_ids: number[];
}

export interface ReceivedTaxBasis {
  document_id: number;
  document_type: string;
  document_tax_amount: string | null;
  representation: ReceivedTaxRepresentation;
  groups: ReceivedTaxBasisGroup[];
  blockers: ReceivedTaxBasisBlocker[];
  facts_hash: string;
}

const DOCUMENT_TYPES = new Set<ReceivedTaxDocumentType>([
  'invoice', 'credit_note', 'debit_note', 'non_electronic',
]);
const KNOWN_TAX_TYPES = new Set([
  'iva', 'inc', 'ica', 'withholding', 'reteiva', 'reteica', 'icui', 'ibua',
]);
const WITHHOLDING_TYPES = new Set(['withholding', 'reteiva', 'reteica']);
const MONEY_TOLERANCE = new Prisma.Decimal('0.01');

type BasisQualifier = ReceivedTaxBasisGroup['basis_qualifier'];
type ParsedRow = {
  source: ReceivedTaxBasisInput['tax_rows'][number];
  tax_type: string | null;
  scheme_code: string | null;
  rate: string | null;
  base_amount: Prisma.Decimal;
  amount: Prisma.Decimal;
  base_quantity: Prisma.Decimal | null;
  key: string;
  basis_qualifier: BasisQualifier;
};
type GroupAccumulator = {
  rows: ParsedRow[];
  amount: Prisma.Decimal;
  baseAmount: Prisma.Decimal;
  baseQuantity: Prisma.Decimal | null;
};

function parseDecimal(value: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal | null {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return null;
  try {
    const decimal = new Prisma.Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

function moneyString(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function rateString(value: Prisma.Decimal): string {
  return value.toFixed(Math.max(0, value.decimalPlaces()));
}

function stringOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function rowKey(row: Pick<ParsedRow, 'tax_type' | 'scheme_code' | 'rate' | 'basis_qualifier'>): string {
  return JSON.stringify([row.tax_type, row.scheme_code, row.rate, row.basis_qualifier]);
}

function compareGroup(a: ReceivedTaxBasisGroup, b: ReceivedTaxBasisGroup): number {
  return JSON.stringify([a.tax_type, a.scheme_code, a.rate, a.basis_qualifier])
    .localeCompare(JSON.stringify([b.tax_type, b.scheme_code, b.rate, b.basis_qualifier]));
}

function addBlocker(blockers: Map<string, Set<number>>, code: string, ids: number[] = []): void {
  const evidence = blockers.get(code) ?? new Set<number>();
  for (const id of ids) evidence.add(id);
  blockers.set(code, evidence);
}

function readBasisFacts(metadata: unknown): {
  qualifier: BasisQualifier | null;
  baseQuantity: Prisma.Decimal | null;
  perUnitAmount: Prisma.Decimal | null;
  malformed: boolean;
  hasNominalFields: boolean;
} {
  if (metadata == null) {
    return {
      qualifier: { tax_basis_type: 'monetary', base_unit_code: null, per_unit_amount: null },
      baseQuantity: null, perUnitAmount: null, malformed: false, hasNominalFields: false,
    };
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { qualifier: null, baseQuantity: null, perUnitAmount: null, malformed: true, hasNominalFields: false };
  }
  const meta = metadata as Record<string, unknown>;
  const typeValue = meta['tax_basis_type'];
  const tax_basis_type = typeValue == null ? 'monetary' : typeValue;
  if (tax_basis_type !== 'monetary' && tax_basis_type !== 'unit') {
    return { qualifier: null, baseQuantity: null, perUnitAmount: null, malformed: true, hasNominalFields: false };
  }
  const hasNominalFields = ['base_quantity', 'base_unit_code', 'per_unit_amount']
    .some((key) => meta[key] != null);
  const unitCode = meta['base_unit_code'];
  const base_unit_code = typeof unitCode === 'string' ? unitCode.trim() || null : unitCode == null ? null : '';
  const baseQuantity = meta['base_quantity'] == null ? null : parseDecimal(String(meta['base_quantity']));
  const perUnitAmount = meta['per_unit_amount'] == null ? null : parseDecimal(String(meta['per_unit_amount']));
  const qualifier: BasisQualifier = {
    tax_basis_type,
    base_unit_code,
    per_unit_amount: perUnitAmount?.toFixed(2) ?? (meta['per_unit_amount'] == null ? null : String(meta['per_unit_amount']).trim()),
  };
  return { qualifier, baseQuantity, perUnitAmount, malformed: unitCode != null && typeof unitCode !== 'string', hasNominalFields };
}

function groupRows(rows: ParsedRow[]): Map<string, GroupAccumulator> {
  const groups = new Map<string, GroupAccumulator>();
  for (const row of rows) {
    const current = groups.get(row.key) ?? {
      rows: [], amount: new Prisma.Decimal(0), baseAmount: new Prisma.Decimal(0), baseQuantity: null,
    };
    current.rows.push(row);
    current.amount = current.amount.plus(row.amount);
    current.baseAmount = current.baseAmount.plus(row.base_amount);
    if (row.base_quantity != null) {
      current.baseQuantity = (current.baseQuantity ?? new Prisma.Decimal(0)).plus(row.base_quantity);
    }
    groups.set(row.key, current);
  }
  for (const group of groups.values()) group.rows.sort((a, b) => a.source.id - b.source.id);
  return groups;
}

/**
 * Builds immutable tax-basis evidence from received-document tax rows. It is
 * not a tax eligibility decision and never turns non-IVA taxes into IVA.
 */
export function buildReceivedTaxBasis(input: ReceivedTaxBasisInput): ReceivedTaxBasis {
  const blockers = new Map<string, Set<number>>();
  if (!Number.isSafeInteger(input.document_id) || input.document_id <= 0) {
    throw new Error('document_id must be a positive safe integer');
  }
  const document_type = input.document_type;
  if (!DOCUMENT_TYPES.has(input.document_type)) addBlocker(blockers, 'INVALID_DOCUMENT_TYPE');

  const documentTax = parseDecimal(input.tax_amount);
  let document_tax_amount: string | null = null;
  if (!documentTax || documentTax.isNegative() || documentTax.decimalPlaces() > 2) {
    addBlocker(blockers, 'INVALID_DOCUMENT_TAX_AMOUNT');
  } else {
    document_tax_amount = moneyString(documentTax);
  }

  const parsedRows: ParsedRow[] = [];
  for (const row of input.tax_rows ?? []) {
    const rowIdValid = Number.isSafeInteger(row.id) && row.id > 0;
    const evidenceIds = rowIdValid ? [row.id] : [];
    if (!rowIdValid) addBlocker(blockers, 'INVALID_TAX_ROW_ID');

    const tax_type = stringOrNull(row.tax_type)?.toLowerCase() ?? null;
    if (!tax_type || !KNOWN_TAX_TYPES.has(tax_type)) addBlocker(blockers, 'UNKNOWN_TAX_TYPE', evidenceIds);

    const amount = parseDecimal(row.amount);
    if (!amount || amount.isNegative() || amount.decimalPlaces() > 2) {
      addBlocker(blockers, 'INVALID_TAX_AMOUNT', evidenceIds);
      continue;
    }
    const base_amount = parseDecimal(row.base_amount);
    if (!base_amount || base_amount.isNegative() || base_amount.decimalPlaces() > 2) {
      addBlocker(blockers, 'INVALID_TAX_BASE_AMOUNT', evidenceIds);
      continue;
    }

    const rate = parseDecimal(row.rate);
    if (row.rate != null && (!rate || rate.isNegative() || rate.gt(100) || rate.decimalPlaces() > 5)) {
      addBlocker(blockers, 'INVALID_TAX_RATE', evidenceIds);
      continue;
    }
    const scheme_code = stringOrNull(row.scheme_code);
    if (tax_type === 'iva' && amount.isPositive()) {
      if (scheme_code == null) addBlocker(blockers, 'MISSING_IVA_SCHEME_CODE', evidenceIds);
      if (rate == null) addBlocker(blockers, 'MISSING_IVA_RATE', evidenceIds);
    }

    const basis = readBasisFacts(row.metadata);
    if (basis.malformed) {
      addBlocker(blockers, 'INVALID_UNIT_TAX_BASIS', evidenceIds);
      continue;
    }
    let base_quantity: Prisma.Decimal | null = null;
    if (basis.qualifier?.tax_basis_type === 'unit') {
      const validUnitBasis = tax_type === 'ibua' && scheme_code === '34' && rate?.isZero() === true &&
        basis.baseQuantity?.isPositive() === true && basis.baseQuantity.decimalPlaces() <= 2 &&
        basis.perUnitAmount?.isNegative() === false && basis.perUnitAmount?.decimalPlaces() <= 2 &&
        basis.qualifier.base_unit_code != null && basis.qualifier.base_unit_code.length <= 30 &&
        basis.qualifier.per_unit_amount != null;
      if (!validUnitBasis) {
        addBlocker(blockers, 'INVALID_UNIT_TAX_BASIS', evidenceIds);
        continue;
      }
      const expectedAmount = basis.baseQuantity!.mul(basis.perUnitAmount!)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN)
        .div(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
      if (amount.minus(expectedAmount).abs().gt(MONEY_TOLERANCE)) {
        addBlocker(blockers, 'INVALID_UNIT_TAX_BASIS', evidenceIds);
        continue;
      }
      base_quantity = basis.baseQuantity!;
    } else if (basis.qualifier?.tax_basis_type === 'monetary') {
      if (basis.hasNominalFields) {
        addBlocker(blockers, 'INVALID_UNIT_TAX_BASIS', evidenceIds);
        continue;
      }
    } else {
      addBlocker(blockers, 'INVALID_UNIT_TAX_BASIS', evidenceIds);
      continue;
    }

    const parsed: ParsedRow = {
      source: row,
      tax_type,
      scheme_code,
      rate: rate == null ? null : rateString(rate),
      base_amount,
      amount,
      base_quantity,
      key: '',
      basis_qualifier: basis.qualifier,
    };
    parsed.key = rowKey(parsed);
    parsedRows.push(parsed);
  }

  const headerRows = parsedRows.filter((row) => row.source.item_id == null);
  const itemRows = parsedRows.filter((row) => row.source.item_id != null);
  const rawRows = input.tax_rows ?? [];
  const hasHeaderRows = rawRows.some((row) => row.item_id == null);
  const representation: ReceivedTaxRepresentation = hasHeaderRows ? 'header' : itemRows.length ? 'item' : 'none';
  const headerGroups = groupRows(headerRows);
  const itemGroups = groupRows(itemRows);

  if (hasHeaderRows && rawRows.some((row) => row.item_id != null)) {
    const keys = new Set([...headerGroups.keys(), ...itemGroups.keys()]);
    for (const key of keys) {
      const header = headerGroups.get(key);
      const items = itemGroups.get(key);
      const taxIds = [
        ...(header?.rows.map((row) => row.source.id) ?? []),
        ...(items?.rows.map((row) => row.source.id) ?? []),
      ];
      const headerAmount = header?.amount ?? new Prisma.Decimal(0);
      const itemAmount = items?.amount ?? new Prisma.Decimal(0);
      if (headerAmount.minus(itemAmount).abs().gt(MONEY_TOLERANCE)) {
        addBlocker(blockers, 'HEADER_ITEM_TAX_MISMATCH', taxIds);
      }
      const unitGroup = header?.rows[0]?.basis_qualifier.tax_basis_type === 'unit' ||
        items?.rows[0]?.basis_qualifier.tax_basis_type === 'unit';
      if (unitGroup) {
        const headerQuantity = header?.baseQuantity ?? new Prisma.Decimal(0);
        const itemQuantity = items?.baseQuantity ?? new Prisma.Decimal(0);
        if (headerQuantity.minus(itemQuantity).abs().gt(MONEY_TOLERANCE)) {
          addBlocker(blockers, 'HEADER_ITEM_UNIT_BASIS_MISMATCH', taxIds);
        }
      }
    }
  }

  const chosenGroups = representation === 'header' ? headerGroups : itemGroups;
  const groups: ReceivedTaxBasisGroup[] = [...chosenGroups.values()].map(({ rows, amount, baseAmount, baseQuantity }) => ({
    tax_type: rows[0].tax_type,
    scheme_code: rows[0].scheme_code,
    rate: rows[0].rate,
    basis_qualifier: rows[0].basis_qualifier,
    base_quantity: baseQuantity?.toFixed(2) ?? null,
    base_amount: moneyString(baseAmount),
    tax_amount: moneyString(amount),
    evidence_tax_ids: [...new Set([
      ...rows.map((row) => row.source.id),
      ...(representation === 'header' ? itemGroups.get(rows[0].key)?.rows.map((row) => row.source.id) ?? [] : []),
    ])].sort((a, b) => a - b),
  })).sort(compareGroup);

  const chosenNonWithholdingAmount = groups.reduce((sum, group) => {
    if (group.tax_type == null || WITHHOLDING_TYPES.has(group.tax_type)) return sum;
    return sum.plus(group.tax_amount);
  }, new Prisma.Decimal(0));
  if (documentTax?.isPositive() && rawRows.length === 0) {
    addBlocker(blockers, 'MISSING_POSITIVE_TAX_ROWS');
  } else if (documentTax && documentTax.isFinite() && !documentTax.isNegative() &&
    chosenNonWithholdingAmount.minus(documentTax).abs().gt(MONEY_TOLERANCE)) {
    addBlocker(blockers, 'DOCUMENT_TAX_AMOUNT_MISMATCH', groups
      .filter((group) => group.tax_type != null && !WITHHOLDING_TYPES.has(group.tax_type))
      .flatMap((group) => group.evidence_tax_ids));
  }

  const canonicalBlockers = [...blockers.entries()]
    .map(([code, ids]) => ({ code, evidence_tax_ids: [...ids].sort((a, b) => a - b) }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const facts = {
    document_id: input.document_id,
    document_type,
    document_tax_amount,
    representation,
    groups,
    blockers: canonicalBlockers,
  };
  const facts_hash = createHash('sha256').update(JSON.stringify(facts)).digest('hex');
  return { ...facts, facts_hash };
}
