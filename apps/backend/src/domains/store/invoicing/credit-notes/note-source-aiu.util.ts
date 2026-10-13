import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import {
  AIU_COMPONENTS,
  AIU_COMPONENTS_BASES,
  AIU_TAXABLE_BASES,
} from '../profiles/invoice-profile-config.contract';
import type { AiuComponentsBasis, AiuTaxableBasis } from '../profiles/invoice-profile-config.contract';
import type { InvoiceCalculatorAiuInput } from '../services/invoice-calculator.service';
import type { NoteSourceInvoiceSnapshot } from './note-source-resolver.util';

type JsonObject = Record<string, unknown>;
const MATRIX_COMPONENTS: readonly string[] = [...AIU_COMPONENTS, 'contrato'];

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(source: NoteSourceInvoiceSnapshot, reason: string): never {
  throw new VendixHttpException(
    ErrorCodes.INVOICING_NOTE_SOURCE_001,
    undefined,
    { reason, parent_invoice_id: source.id },
  );
}

function decimal(source: NoteSourceInvoiceSnapshot, value: unknown, field: string): Prisma.Decimal {
  let result: Prisma.Decimal;
  try {
    result = new Prisma.Decimal(value as Prisma.Decimal.Value);
  } catch {
    return fail(source, `aiu_${field}_invalid`);
  }
  if (!result.isFinite() || result.isNegative()) {
    return fail(source, `aiu_${field}_invalid`);
  }
  return result;
}

/** Resolve only immutable AIU data captured with the source invoice. */
export function resolveFrozenNoteAiuInput(
  source: NoteSourceInvoiceSnapshot,
): InvoiceCalculatorAiuInput | undefined {
  if (source.operation_type !== '09') return undefined;

  if (!source.aiu_contract_object || !isObject(source.aiu_taxable_matrix)) {
    return fail(source, 'aiu_snapshot_incomplete');
  }
  const matrix = source.aiu_taxable_matrix;
  if (!Array.isArray(matrix['components']) || !Array.isArray(matrix['taxable_without_rate'])) {
    return fail(source, 'aiu_matrix_snapshot_incomplete');
  }
  const matrixComponentNames = new Set<string>();
  for (const rawComponent of matrix['components']) {
    if (
      !isObject(rawComponent) ||
      typeof rawComponent['component'] !== 'string' ||
      !MATRIX_COMPONENTS.includes(rawComponent['component']) ||
      typeof rawComponent['taxable'] !== 'boolean' ||
      !Number.isSafeInteger(rawComponent['lines']) ||
      Number(rawComponent['lines']) < 1 ||
      !Array.isArray(rawComponent['rates'])
    ) {
      return fail(source, 'aiu_matrix_component_invalid');
    }
    if (matrixComponentNames.has(rawComponent['component'])) {
      return fail(source, 'aiu_matrix_component_duplicate');
    }
    matrixComponentNames.add(rawComponent['component']);
    decimal(source, rawComponent['taxable_amount'], 'matrix_component_base');
    decimal(source, rawComponent['tax_amount'], 'matrix_component_tax');
    for (const rawRate of rawComponent['rates']) {
      if (
        !isObject(rawRate) ||
        typeof rawRate['tax_type'] !== 'string' ||
        typeof rawRate['dian_tax_code'] !== 'string' ||
        typeof rawRate['rate_basis'] !== 'string' ||
        typeof rawRate['tax_rate'] !== 'string'
      ) {
        return fail(source, 'aiu_matrix_rate_invalid');
      }
      decimal(source, rawRate['tax_rate'], 'matrix_tax_rate');
    }
  }
  if (matrix['taxable_without_rate'].some((component) => typeof component !== 'string')) {
    return fail(source, 'aiu_matrix_missing_rate_snapshot_invalid');
  }
  const taxable_basis = matrix['taxable_basis'];
  if (
    typeof taxable_basis !== 'string' ||
    !AIU_TAXABLE_BASES.includes(taxable_basis as AiuTaxableBasis)
  ) {
    return fail(source, 'aiu_taxable_basis_missing_or_invalid');
  }

  const expectedRegime = taxable_basis === 'aiu'
    ? 'et_462_1'
    : taxable_basis === 'utilidad'
      ? 'decreto_1372_1992'
      : null;
  const expectedSourceRegime = taxable_basis === 'subtotal' ? 'subtotal' : expectedRegime;
  const matrixRegime = matrix['regime'];
  if (
    matrixRegime !== expectedRegime ||
    source.aiu_regime !== expectedSourceRegime
  ) {
    return fail(source, 'aiu_regime_matrix_conflict');
  }

  const minimum = matrix['minimum'];
  if (!isObject(minimum) || typeof minimum['enforced'] !== 'boolean') {
    return fail(source, 'aiu_minimum_snapshot_incomplete');
  }
  const enforce_minimum_base = minimum['enforced'];
  let minimum_base_percent: Prisma.Decimal | undefined;
  if (enforce_minimum_base) {
    if (
      taxable_basis !== 'aiu' ||
      expectedRegime !== 'et_462_1' ||
      minimum['percent'] === null ||
      minimum['percent'] === undefined ||
      source.aiu_minimum_percent === null ||
      source.aiu_minimum_percent === undefined
    ) {
      return fail(source, 'aiu_minimum_percent_missing');
    }
    const matrixPercent = decimal(source, minimum['percent'], 'matrix_minimum_percent');
    minimum_base_percent = decimal(source, source.aiu_minimum_percent, 'minimum_percent');
    if (
      matrixPercent.greaterThan(100) ||
      minimum_base_percent.greaterThan(100) ||
      !matrixPercent.equals(minimum_base_percent)
    ) {
      return fail(source, 'aiu_minimum_percent_conflict');
    }
  } else if (
    minimum['percent'] !== null ||
    source.aiu_minimum_percent !== null
  ) {
    // The persisted representation explicitly disables the floor. A null or
    // missing live setting must never be allowed to re-enable the calculator's
    // default.
    return fail(source, 'aiu_disabled_minimum_snapshot_conflict');
  }

  let components: InvoiceCalculatorAiuInput['components'];
  let components_basis: AiuComponentsBasis | undefined;
  if (source.invoice_items.some((item) => item.aiu_component === 'contrato')) {
    const profile = source.profile_snapshot;
    const profileConfig = profile && isObject(profile.config) ? profile.config : null;
    const profileAiu = profileConfig && isObject(profileConfig['aiu'])
      ? profileConfig['aiu']
      : null;
    const rawComponents = profileAiu && isObject(profileAiu['components'])
      ? profileAiu['components']
      : null;
    if (!rawComponents) return fail(source, 'aiu_contract_components_missing');

    const values: Record<string, Prisma.Decimal> = {};
    let sum = new Prisma.Decimal(0);
    for (const component of AIU_COMPONENTS) {
      const value = rawComponents[component];
      if (value === null || value === undefined) {
        return fail(source, 'aiu_contract_components_incomplete');
      }
      const parsed = decimal(source, value, `component_${component}`);
      values[component] = parsed;
      sum = sum.plus(parsed);
    }
    if (sum.isZero() || sum.greaterThan(100)) {
      return fail(source, 'aiu_contract_components_out_of_range');
    }

    const rawBasis = profileAiu?.['components_basis'];
    if (rawBasis === null || rawBasis === undefined) {
      if (!sum.equals(100)) {
        return fail(source, 'aiu_legacy_components_basis_unprovable');
      }
      // Before components_basis existed, contract and AIU units coincide only
      // when the profile split sums to exactly 100.
      components_basis = 'aiu';
    } else if (
      typeof rawBasis === 'string' &&
      AIU_COMPONENTS_BASES.includes(rawBasis as AiuComponentsBasis)
    ) {
      components_basis = rawBasis as AiuComponentsBasis;
    } else {
      return fail(source, 'aiu_components_basis_invalid');
    }
    components = values;
  }

  return {
    taxable_basis: taxable_basis as AiuTaxableBasis,
    enforce_minimum_base,
    ...(minimum_base_percent === undefined ? {} : { minimum_base_percent }),
    ...(components === undefined ? {} : { components }),
    ...(components_basis === undefined ? {} : { components_basis }),
  };
}
