import {
  COD_FREE_CREDIT_NOTICE,
  shouldSwitchCodToFreeCredit,
} from './cod-free-credit.util';

/**
 * cod-auto-invoicing S3 — with automatic e-invoicing on, a contado sale paid
 * «contra entrega» is switched to free credit (the invoice must go out as
 * credit until the money is collected). It never blocks: without a real
 * customer (anonymous / alias) or with the flag off the sale stays as it is.
 */
describe('shouldSwitchCodToFreeCredit', () => {
  const base = {
    methodType: 'cash_on_delivery',
    mode: 'contado' as const,
    autoEmit: true,
    hasRealCustomer: true,
  };

  it('switches a contado + contra entrega sale when auto-emission is on', () => {
    expect(shouldSwitchCodToFreeCredit(base)).toBeTrue();
  });

  it('keeps contado when auto-emission is off', () => {
    expect(shouldSwitchCodToFreeCredit({ ...base, autoEmit: false })).toBeFalse();
  });

  it('keeps contado for other payment methods', () => {
    expect(shouldSwitchCodToFreeCredit({ ...base, methodType: 'cash' })).toBeFalse();
    expect(shouldSwitchCodToFreeCredit({ ...base, methodType: null })).toBeFalse();
  });

  it('does nothing when the sale is already on credit', () => {
    expect(shouldSwitchCodToFreeCredit({ ...base, mode: 'credito' })).toBeFalse();
  });

  it('never blocks a sale without a real customer (anonymous or alias)', () => {
    expect(shouldSwitchCodToFreeCredit({ ...base, hasRealCustomer: false })).toBeFalse();
  });

  it('uses the exact notice requested by the owner', () => {
    expect(COD_FREE_CREDIT_NOTICE).toBe(
      'El pago contra entrega requiere crédito libre: el modo de pago se cambiará a crédito libre',
    );
  });
});
