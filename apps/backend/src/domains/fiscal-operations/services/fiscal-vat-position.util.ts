import { Prisma } from '@prisma/client';

/** Explicitly qualified IVA amounts only; this function does not determine eligibility. */
export interface FiscalVatPositionInput {
  generated_vat: string;
  deductible_vat: string;
  prior_favor_applied: string;
  suffered_reteiva: string;
  qualified_credit_applied: string;
  obligation_payments: string;
  sources_complete: boolean;
  blocking_reasons: readonly string[];
}

export interface FiscalVatPosition {
  period_due: string;
  period_favor: string;
  adjusted_due: string;
  adjusted_favor: string;
  after_credits_due: string;
  obligation_outstanding: string;
  definitive_payable: string | null;
  is_complete: boolean;
  blocking_reasons: readonly string[];
}

const DECIMAL_AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const ZERO = new Prisma.Decimal(0);

function amount(value: unknown, field: string): Prisma.Decimal {
  if (typeof value !== 'string' || !DECIMAL_AMOUNT.test(value)) {
    throw new TypeError(`${field} must be a non-negative decimal string`);
  }
  const parsed = new Prisma.Decimal(value);
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new TypeError(`${field} must be a finite non-negative decimal`);
  }
  return parsed;
}

function money(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Computes an IVA-only fiscal position from pre-qualified source buckets. */
export function calculateFiscalVatPosition(
  input: FiscalVatPositionInput,
): FiscalVatPosition {
  const generated = amount(input.generated_vat, 'generated_vat');
  const deductible = amount(input.deductible_vat, 'deductible_vat');
  const priorFavor = amount(input.prior_favor_applied, 'prior_favor_applied');
  const reteiva = amount(input.suffered_reteiva, 'suffered_reteiva');
  const credit = amount(input.qualified_credit_applied, 'qualified_credit_applied');
  const payments = amount(input.obligation_payments, 'obligation_payments');
  if (typeof input.sources_complete !== 'boolean') {
    throw new TypeError('sources_complete must be a boolean');
  }
  if (!Array.isArray(input.blocking_reasons)) {
    throw new TypeError('blocking_reasons must be an array');
  }
  if (input.blocking_reasons.some((reason) => typeof reason !== 'string' || reason.trim() === '')) {
    throw new TypeError('blocking_reasons must contain nonblank strings');
  }

  const net = generated.minus(deductible);
  const periodDue = Prisma.Decimal.max(net, ZERO);
  const periodFavor = Prisma.Decimal.max(net.negated(), ZERO);
  const offsets = priorFavor.plus(reteiva);
  const adjustedDue = Prisma.Decimal.max(periodDue.minus(offsets), ZERO);
  const adjustedFavor = periodFavor.plus(Prisma.Decimal.max(offsets.minus(periodDue), ZERO));
  if (credit.greaterThan(adjustedDue)) {
    throw new RangeError('qualified_credit_applied exceeds remaining VAT due');
  }
  const afterCreditsDue = adjustedDue.minus(credit);
  if (payments.greaterThan(afterCreditsDue)) {
    throw new RangeError('obligation_payments exceeds remaining VAT due');
  }
  const outstanding = afterCreditsDue.minus(payments);
  const isComplete = input.sources_complete && input.blocking_reasons.length === 0;

  return {
    period_due: money(periodDue),
    period_favor: money(periodFavor),
    adjusted_due: money(adjustedDue),
    adjusted_favor: money(adjustedFavor),
    after_credits_due: money(afterCreditsDue),
    obligation_outstanding: money(outstanding),
    definitive_payable: isComplete ? money(outstanding) : null,
    is_complete: isComplete,
    blocking_reasons: input.blocking_reasons,
  };
}
