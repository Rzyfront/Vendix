import { VendixHttpException } from '@common/errors';
import { shouldRecordCashMovement } from './cash-movement-policy.util';

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
});
