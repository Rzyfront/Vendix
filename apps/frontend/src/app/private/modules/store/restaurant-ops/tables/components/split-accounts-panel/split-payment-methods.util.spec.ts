import { PaymentMethodType } from '../../../../../../../shared/models/payment-method.model';
import type { PaymentMethod } from '../../../../../../../shared/models/payment-method.model';
import { selectChargeableSplitMethods } from './split-payment-methods.util';

function method(overrides: Partial<PaymentMethod>): PaymentMethod {
  return {
    id: '1',
    type: PaymentMethodType.CASH,
    name: 'Método',
    enabled: true,
    ...overrides,
  } as PaymentMethod;
}

describe('selectChargeableSplitMethods', () => {
  it('incluye transferencia bancaria aunque su processing_mode sea ONLINE', () => {
    const transfer = method({
      id: '7',
      type: PaymentMethodType.BANK_TRANSFER,
      name: 'Transferencia Bancaria',
      processingMode: 'ONLINE',
    });

    expect(selectChargeableSplitMethods([transfer])).toEqual([transfer]);
  });

  it('incluye efectivo, tarjeta y wompi habilitados con id numérico', () => {
    const methods = [
      method({ id: '1', type: PaymentMethodType.CASH, processingMode: 'DIRECT' }),
      method({ id: '2', type: PaymentMethodType.CARD, processingMode: 'DIRECT' }),
      method({ id: '3', type: PaymentMethodType.WOMPI, processingMode: 'ONLINE' }),
    ];

    expect(selectChargeableSplitMethods(methods).map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  it('descarta métodos deshabilitados, sin id numérico o de otro tipo', () => {
    const methods = [
      method({ id: '1', enabled: false }),
      method({ id: '', type: PaymentMethodType.CARD }),
      method({ id: 'abc', type: PaymentMethodType.CARD }),
      method({ id: '4', type: PaymentMethodType.PAYPAL, processingMode: 'ONLINE' }),
      method({ id: '5', type: PaymentMethodType.CASH_ON_DELIVERY, processingMode: 'ON_DELIVERY' }),
      method({ id: '6', type: PaymentMethodType.CASH, processingMode: 'ON_DELIVERY' }),
    ];

    expect(selectChargeableSplitMethods(methods)).toEqual([]);
  });

  it('tolera listas vacías o nulas', () => {
    expect(selectChargeableSplitMethods(null)).toEqual([]);
    expect(selectChargeableSplitMethods(undefined)).toEqual([]);
    expect(selectChargeableSplitMethods([])).toEqual([]);
  });
});
