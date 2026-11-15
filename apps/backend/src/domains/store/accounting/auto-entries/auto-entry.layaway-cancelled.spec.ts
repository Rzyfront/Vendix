import { AutoEntryService } from './auto-entry.service';
import { DEFAULT_ACCOUNT_MAPPINGS } from '../account-mappings/account-mapping.service';

/**
 * QUI-893 B2 — the credit side of a cancelled layaway follows where the refund
 * really went: cash 1105, bank transfer / card 1110, customer wallet 2805.
 */
describe('AutoEntryService.onLayawayCancelled — credit follows the refund method', () => {
  const build = () => {
    const mapping = {
      getMapping: jest.fn(async (_o: number, key: string) => {
        const code = DEFAULT_ACCOUNT_MAPPINGS[key]?.code;
        return code ? { account_code: code, source: 'default' } : null;
      }),
    };
    const service = new AutoEntryService(
      {} as any,
      mapping as any,
      { resolveAccountingEntityForFiscal: jest.fn() } as any,
      {
        isAreaEnabled: jest.fn().mockResolvedValue(true),
        isSubflowEnabled: jest.fn().mockResolvedValue(true),
      } as any,
      { recordFailure: jest.fn(), recordSkip: jest.fn() } as any,
    );
    const create = jest.spyOn(service, 'createAutoEntry').mockResolvedValue({ id: 1 } as any);
    return { service, create };
  };

  const base = {
    plan_id: 12,
    plan_number: 'LAY-0012',
    organization_id: 1,
    store_id: 10,
    total_paid: 60000,
    refund_amount: 50000,
    cancellation_fee: 10000,
  };

  it.each([
    ['cash', '1105'],
    [undefined, '1105'],
    ['bank_transfer', '1110'],
    ['card', '1110'],
    ['wallet', '2805'],
  ])('refund_method %s credits %s and the entry balances', async (refund_method, code) => {
    const { service, create } = build();
    await service.onLayawayCancelled({ ...base, refund_method });
    const arg = create.mock.calls[0][0] as any;
    const [advance, refund, fee] = arg.lines;
    expect(advance).toMatchObject({ account_code: '2805', debit_amount: 60000 });
    expect(refund).toMatchObject({ account_code: code, credit_amount: 50000 });
    expect(fee).toMatchObject({ account_code: '4295', credit_amount: 10000 });
    const debits = arg.lines.reduce((s: number, l: any) => s + l.debit_amount, 0);
    const credits = arg.lines.reduce((s: number, l: any) => s + l.credit_amount, 0);
    expect(debits).toBe(credits);
  });
});
