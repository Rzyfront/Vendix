import { VendixHttpException } from '@common/errors';
import {
  shouldRecordCashMovement,
  tracksNonCashPayments,
} from './cash-movement-policy.util';

describe('shouldRecordCashMovement', () => {
  it.each([
    ['cash', 'DIRECT', true],
    ['cash', null, true],
    ['card', 'DIRECT', true],
    ['card', 'ONLINE', true],
    ['bank_transfer', 'DIRECT', true],
    ['voucher', 'DIRECT', true],
    ['cash_on_delivery', 'DIRECT', false],
    ['cash', 'ON_DELIVERY', false],
    ['wompi', 'ONLINE', false],
    ['wompi', 'DIRECT', false],
    ['wallet', 'DIRECT', false],
  ])('%s / %s -> %s', (type, mode, expected) => {
    expect(shouldRecordCashMovement(type, mode)).toBe(expected);
  });

  it.each([[undefined], [null], ['']])(
    'rejects a missing method type (%p) with PAY_METHOD_MISCONFIGURED',
    (type) => {
      try {
        shouldRecordCashMovement(type as any, 'DIRECT');
        fail('expected throw');
      } catch (e: any) {
        expect(e).toBeInstanceOf(VendixHttpException);
        expect(e.getResponse().error_code).toBe('PAY_METHOD_MISCONFIGURED');
      }
    },
  );

  describe('track_non_cash_payments = false', () => {
    it.each([
      ['card', 'DIRECT'],
      ['bank_transfer', 'DIRECT'],
      ['voucher', null],
    ])('%s / %s is not recorded', (type, mode) => {
      expect(shouldRecordCashMovement(type, mode, false)).toBe(false);
    });

    it('still records cash', () => {
      expect(shouldRecordCashMovement('cash', 'DIRECT', false)).toBe(true);
    });

    it('still rejects a missing method type', () => {
      expect(() => shouldRecordCashMovement('', 'DIRECT', false)).toThrow(
        VendixHttpException,
      );
    });
  });
});

describe('tracksNonCashPayments', () => {
  it.each([
    [{ pos: { cash_register: { track_non_cash_payments: false } } }, false],
    [{ pos: { cash_register: { track_non_cash_payments: true } } }, true],
    // Absent = store default (`true`): stores that never saved the toggle keep today's behavior.
    [{ pos: { cash_register: { enabled: true } } }, true],
    [{}, true],
    [null, true],
    [undefined, true],
  ])('%j -> %s', (settings, expected) => {
    expect(tracksNonCashPayments(settings)).toBe(expected);
  });
});
