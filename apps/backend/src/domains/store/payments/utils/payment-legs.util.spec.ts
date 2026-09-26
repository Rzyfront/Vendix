import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import {
  normalizePaymentLegs,
  PaymentLegMethodInfo,
} from './payment-legs.util';

/**
 * Normalizador único del cobro multimétodo de contado:
 *   · escalar ⇒ 1 tramo con el comportamiento de hoy;
 *   · `payments[]` ⇒ N tramos validados (método directo, un solo efectivo,
 *     Σ = total a cobrar al centavo, recibido ≥ monto en efectivo).
 *
 * Cada rechazo fija su `errorCode` dedicado: no basta `toBeInstanceOf`.
 */
describe('normalizePaymentLegs', () => {
  const CASH = 11;
  const CASH_2 = 12;
  const TRANSFER = 21;
  const CARD = 22;
  const WOMPI = 31;
  const COD = 41;

  const methodsById: Record<number, PaymentLegMethodInfo> = {
    [CASH]: { type: 'cash', processing_mode: 'DIRECT' },
    [CASH_2]: { type: 'cash', processing_mode: 'DIRECT' },
    [TRANSFER]: { type: 'bank_transfer', processing_mode: 'ONLINE' },
    [CARD]: { type: 'card', processing_mode: 'DIRECT' },
    [WOMPI]: { type: 'wompi', processing_mode: 'ONLINE' },
    [COD]: { type: 'cash_on_delivery', processing_mode: 'ON_DELIVERY' },
  };

  const expectRejection = (fn: () => unknown, code: string) => {
    let caught: any;
    try {
      fn();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VendixHttpException);
    expect(caught.errorCode).toBe(code);
    expect(caught.getStatus()).toBe(400);
  };

  it('contrato escalar ⇒ un solo tramo por el total, sin vuelto cuando el recibido iguala', () => {
    const { legs, change } = normalizePaymentLegs(
      {
        store_payment_method_id: TRANSFER,
        payment_reference: 'ref-1',
      },
      100000,
      methodsById,
    );
    expect(legs).toEqual([
      {
        store_payment_method_id: TRANSFER,
        amount: 100000,
        amount_received: undefined,
        payment_reference: 'ref-1',
        bank_account_id: undefined,
        is_cash: false,
      },
    ]);
    expect(change).toBe(0);
  });

  it('20.000 efectivo + 80.000 transferencia = 100.000 ⇒ OK', () => {
    const { legs, change } = normalizePaymentLegs(
      {
        payments: [
          { store_payment_method_id: CASH, amount: 20000 },
          {
            store_payment_method_id: TRANSFER,
            amount: 80000,
            payment_reference: 'tx-9',
          },
        ],
      },
      100000,
      methodsById,
    );
    expect(legs.map((leg) => leg.amount)).toEqual([20000, 80000]);
    expect(legs.map((leg) => leg.is_cash)).toEqual([true, false]);
    expect(change).toBe(0);
  });

  it('20.000 + 79.999 ≠ 100.000 ⇒ PAY_MULTI_TENDER_SUM_MISMATCH (tolerancia cero)', () => {
    expectRejection(
      () =>
        normalizePaymentLegs(
          {
            payments: [
              { store_payment_method_id: CASH, amount: 20000 },
              { store_payment_method_id: TRANSFER, amount: 79999 },
            ],
          },
          100000,
          methodsById,
        ),
      ErrorCodes.PAY_MULTI_TENDER_SUM_MISMATCH.code,
    );
  });

  it('dos tramos en efectivo ⇒ PAY_MULTI_TENDER_MULTIPLE_CASH', () => {
    expectRejection(
      () =>
        normalizePaymentLegs(
          {
            payments: [
              { store_payment_method_id: CASH, amount: 50000 },
              { store_payment_method_id: CASH_2, amount: 50000 },
            ],
          },
          100000,
          methodsById,
        ),
      ErrorCodes.PAY_MULTI_TENDER_MULTIPLE_CASH.code,
    );
  });

  it('tramo Wompi ⇒ PAY_MULTI_TENDER_METHOD_NOT_ALLOWED', () => {
    expectRejection(
      () =>
        normalizePaymentLegs(
          {
            payments: [
              { store_payment_method_id: CARD, amount: 20000 },
              { store_payment_method_id: WOMPI, amount: 80000 },
            ],
          },
          100000,
          methodsById,
        ),
      ErrorCodes.PAY_MULTI_TENDER_METHOD_NOT_ALLOWED.code,
    );
  });

  it('tramo contra entrega ⇒ PAY_MULTI_TENDER_METHOD_NOT_ALLOWED', () => {
    expectRejection(
      () =>
        normalizePaymentLegs(
          {
            payments: [
              { store_payment_method_id: CASH, amount: 20000 },
              { store_payment_method_id: COD, amount: 80000 },
            ],
          },
          100000,
          methodsById,
        ),
      ErrorCodes.PAY_MULTI_TENDER_METHOD_NOT_ALLOWED.code,
    );
  });

  it('efectivo con recibido 0 ⇒ PAY_MULTI_TENDER_CASH_INSUFFICIENT (0 no es ausente)', () => {
    expectRejection(
      () =>
        normalizePaymentLegs(
          {
            payments: [
              {
                store_payment_method_id: CASH,
                amount: 20000,
                amount_received: 0,
              },
              { store_payment_method_id: TRANSFER, amount: 80000 },
            ],
          },
          100000,
          methodsById,
        ),
      ErrorCodes.PAY_MULTI_TENDER_CASH_INSUFFICIENT.code,
    );
  });

  it('vuelto = recibido − monto del tramo en efectivo (50.000 − 20.000 = 30.000)', () => {
    const { legs, change } = normalizePaymentLegs(
      {
        payments: [
          {
            store_payment_method_id: CASH,
            amount: 20000,
            amount_received: 50000,
          },
          { store_payment_method_id: TRANSFER, amount: 80000 },
        ],
      },
      100000,
      methodsById,
    );
    expect(legs).toHaveLength(2);
    expect(change).toBe(30000);
  });

  it('método desconocido (fuera del mapa) ⇒ PAY_MULTI_TENDER_METHOD_NOT_ALLOWED (fail closed)', () => {
    expectRejection(
      () =>
        normalizePaymentLegs(
          {
            payments: [
              { store_payment_method_id: CASH, amount: 20000 },
              { store_payment_method_id: 999, amount: 80000 },
            ],
          },
          100000,
          methodsById,
        ),
      ErrorCodes.PAY_MULTI_TENDER_METHOD_NOT_ALLOWED.code,
    );
  });

  it('tramo con monto negativo ⇒ PAY_INVALID_AMOUNT_001 (la Σ no se puede jugar con signos)', () => {
    expectRejection(
      () =>
        normalizePaymentLegs(
          {
            payments: [
              { store_payment_method_id: CASH, amount: 150000 },
              { store_payment_method_id: TRANSFER, amount: -50000 },
            ],
          },
          100000,
          methodsById,
        ),
      ErrorCodes.PAY_INVALID_AMOUNT_001.code,
    );
  });
});
