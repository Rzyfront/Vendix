import { AutoEntryService } from './auto-entry.service';

describe('AutoEntryService.onInstallmentWithholdingApplied — retención sufrida en recaudo de ruta a crédito', () => {
  const CODES: Record<string, string> = {
    'withholding.suffered.retefuente_receivable': '135515',
    'withholding.suffered.reteiva_receivable': '135517',
    'installment_payment.received.accounts_receivable': '130505',
  };

  const build = () => {
    const mapping = {
      getMapping: jest.fn(async (_o: number, key: string) =>
        CODES[key] ? { account_code: CODES[key], source: 'default' } : null,
      ),
    };
    const service = new AutoEntryService(
      {} as any,
      mapping as any,
      { resolveAccountingEntityForFiscal: jest.fn() } as any,
      { isAreaEnabled: jest.fn().mockResolvedValue(true), isSubflowEnabled: jest.fn().mockResolvedValue(true) } as any,
      { recordFailure: jest.fn(), recordSkip: jest.fn() } as any,
    );
    const create = jest.spyOn(service, 'createAutoEntry').mockResolvedValue({ id: 1 } as any);
    return { service, create };
  };

  it('DR cuentas de retención (1355xx) por W / CR CxC por W, balanceado', async () => {
    const { service, create } = build();

    await service.onInstallmentWithholdingApplied({
      payment_id: 77, order_id: 5, store_id: 2, organization_id: 1,
      credit_number: 'ORD-5', breakdown: { retefuente: 15, reteiva: 5 },
    });

    const arg = create.mock.calls[0][0] as any;
    expect(arg.source_type).toBe('installment_withholding');
    expect(arg.source_id).toBe(77);
    const lines = arg.lines.filter(Boolean);
    const debit = lines.reduce((a: number, l: any) => a + l.debit_amount, 0);
    const credit = lines.reduce((a: number, l: any) => a + l.credit_amount, 0);
    expect(debit).toBe(20);
    expect(credit).toBe(20);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account_code: '135515', debit_amount: 15 }),
        expect.objectContaining({ account_code: '135517', debit_amount: 5 }),
        expect.objectContaining({ account_code: '130505', credit_amount: 20 }),
      ]),
    );
  });

  it('sin retención positiva: no crea asiento', async () => {
    const { service, create } = build();
    const res = await service.onInstallmentWithholdingApplied({
      payment_id: 77, order_id: 5, store_id: 2, organization_id: 1,
      credit_number: 'ORD-5', breakdown: {},
    });
    expect(res).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
