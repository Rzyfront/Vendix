import { VendixHttpException } from 'src/common/errors';
import {
  assertNoActiveFinancialSplit,
  isFinancialSplitSettled,
} from './financial-split-policy';

const pay = (amount: number, state = 'succeeded') => ({ state, amount });

describe('isFinancialSplitSettled', () => {
  it('false sin split activo aunque este pagada', () => {
    expect(
      isFinancialSplitSettled({ active_financial_split_id: null, grand_total: 100, payments: [pay(100)] }),
    ).toBe(false);
  });

  it('true con split activo y pagos liquidados >= grand_total', () => {
    expect(
      isFinancialSplitSettled({ active_financial_split_id: 3, grand_total: 138500, payments: [pay(60000), pay(78500)] }),
    ).toBe(true);
  });

  it('false con split activo y pago parcial o pagos pendientes', () => {
    expect(isFinancialSplitSettled({ active_financial_split_id: 3, grand_total: 100, payments: [pay(60)] })).toBe(false);
    expect(
      isFinancialSplitSettled({ active_financial_split_id: 3, grand_total: 100, payments: [pay(60), pay(40, 'pending')] }),
    ).toBe(false);
  });

  it('false con total cero o sin pagos', () => {
    expect(isFinancialSplitSettled({ active_financial_split_id: 3, grand_total: 0, payments: [] })).toBe(false);
    expect(isFinancialSplitSettled({ active_financial_split_id: 3, grand_total: 100 })).toBe(false);
  });

  it('assertNoActiveFinancialSplit sigue lanzando aun con split saldado', () => {
    expect(() => assertNoActiveFinancialSplit({ active_financial_split_id: 3 })).toThrow(VendixHttpException);
  });
});
