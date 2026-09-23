import { resolvePosPaymentCustomerName } from './pos.component';

describe('POS paid-order customer name', () => {
  it('shows the persisted alias instead of an anonymous placeholder', () => {
    expect(resolvePosPaymentCustomerName(
      { customer_alias: 'QA H3 E2E POS mesa sin IVA', customer_name: 'Consumidor Final' },
      null,
      true,
    )).toBe('QA H3 E2E POS mesa sin IVA');
  });

  it('keeps a genuinely anonymous sale as Consumidor Final', () => {
    expect(resolvePosPaymentCustomerName({}, null, true)).toBe('Consumidor Final');
  });

  it('keeps a formal customer name', () => {
    expect(resolvePosPaymentCustomerName(
      { customer_name: 'Ana Gómez' },
      { first_name: 'Ana', last_name: 'Gómez' },
      false,
    )).toBe('Ana Gómez');
  });
});
