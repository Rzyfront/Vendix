import { calculateFiscalVatPosition } from './fiscal-vat-position.util';

const base = {
  generated_vat: '0',
  deductible_vat: '0',
  prior_favor_applied: '0',
  suffered_reteiva: '0',
  qualified_credit_applied: '0',
  obligation_payments: '0',
  sources_complete: true,
  blocking_reasons: [] as readonly string[],
};

describe('calculateFiscalVatPosition', () => {
  it('reports period due and period favor independently', () => {
    expect(calculateFiscalVatPosition({ ...base, generated_vat: '125', deductible_vat: '25' }))
      .toMatchObject({ period_due: '100.00', period_favor: '0.00', adjusted_due: '100.00' });
    expect(calculateFiscalVatPosition({ ...base, generated_vat: '20', deductible_vat: '35' }))
      .toMatchObject({ period_due: '0.00', period_favor: '15.00', adjusted_favor: '15.00' });
  });

  it('applies prior favor and suffered reteIVA, creating favor if offsets exceed due', () => {
    expect(calculateFiscalVatPosition({
      ...base, generated_vat: '100', prior_favor_applied: '20', suffered_reteiva: '15',
    })).toMatchObject({ adjusted_due: '65.00', adjusted_favor: '0.00' });
    expect(calculateFiscalVatPosition({
      ...base, generated_vat: '10', prior_favor_applied: '8', suffered_reteiva: '5',
    })).toMatchObject({ adjusted_due: '0.00', adjusted_favor: '3.00' });
  });

  it('applies qualified credits and payments with separate due/outstanding values', () => {
    expect(calculateFiscalVatPosition({
      ...base, generated_vat: '100', qualified_credit_applied: '20', obligation_payments: '30',
    })).toMatchObject({ period_due: '100.00', adjusted_due: '100.00', after_credits_due: '80.00', obligation_outstanding: '50.00' });
  });

  it('rejects credits and payments above their respective remaining due', () => {
    expect(() => calculateFiscalVatPosition({ ...base, generated_vat: '10', qualified_credit_applied: '10.01' })).toThrow(/credit/);
    expect(() => calculateFiscalVatPosition({ ...base, generated_vat: '10', obligation_payments: '10.01' })).toThrow(/payments/);
  });

  it('preserves cent-scale Decimal precision without floating-point math', () => {
    expect(calculateFiscalVatPosition({ ...base, generated_vat: '0.30', deductible_vat: '0.10' }).period_due).toBe('0.20');
    expect(() => calculateFiscalVatPosition({ ...base, generated_vat: '0.105' })).toThrow();
  });

  it('withholds definitive payable for incomplete sources or blocking reasons', () => {
    expect(calculateFiscalVatPosition({ ...base, generated_vat: '10', sources_complete: false }))
      .toMatchObject({ is_complete: false, definitive_payable: null });
    const reasons = ['Missing qualified invoice source'];
    expect(calculateFiscalVatPosition({ ...base, generated_vat: '10', blocking_reasons: reasons }))
      .toMatchObject({ is_complete: false, definitive_payable: null, blocking_reasons: reasons });
  });

  it.each(['', ' ', '-1', '+1', '.5', '1.', '1e2', 'NaN', 'Infinity'])('rejects invalid amount %j', (value) => {
    expect(() => calculateFiscalVatPosition({ ...base, generated_vat: value })).toThrow();
  });

  it('rejects null and non-string buckets instead of coercing to zero', () => {
    expect(() => calculateFiscalVatPosition({ ...base, generated_vat: null } as never)).toThrow();
    expect(() => calculateFiscalVatPosition({ ...base, generated_vat: 0 } as never)).toThrow();
  });

  it('rejects blank blocking reasons', () => {
    expect(() => calculateFiscalVatPosition({ ...base, blocking_reasons: ['  '] })).toThrow(/blocking_reasons/);
  });
});
