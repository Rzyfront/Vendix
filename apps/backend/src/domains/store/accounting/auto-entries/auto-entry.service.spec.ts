import { AutoEntryService } from './auto-entry.service';

describe('AutoEntryService credit note reversal', () => {
  // Dual-source default codes for credit_note.accepted.* keys.
  const MAPPING_CODES: Record<string, string> = {
    'credit_note.accepted.sales_returns': '4175',
    'credit_note.accepted.iva_payable': '2408',
    'credit_note.accepted.inc_payable': '2436',
    'credit_note.accepted.ica_payable': '2412',
    'credit_note.accepted.accounts_receivable': '1305',
  };

  const createService = (overrides: any = {}) => {
    const prisma = {
      chart_of_accounts: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
      ...overrides.prisma,
    };
    const accountMapping = {
      getMapping: jest.fn(
        async (_org: number, mapping_key: string) =>
          MAPPING_CODES[mapping_key]
            ? { account_code: MAPPING_CODES[mapping_key], source: 'default' }
            : null,
      ),
      ...overrides.accountMapping,
    };
    const fiscalScope = {
      resolveAccountingEntityForFiscal: jest.fn(),
      ...overrides.fiscalScope,
    };
    const fiscalGate = {
      isAreaEnabled: jest.fn().mockResolvedValue(true),
      isSubflowEnabled: jest.fn().mockResolvedValue(true),
      ...overrides.fiscalGate,
    };

    const service = new AutoEntryService(
      prisma as any,
      accountMapping as any,
      fiscalScope as any,
      fiscalGate as any,
    );
    const createAutoEntry = jest
      .spyOn(service, 'createAutoEntry')
      .mockResolvedValue({ id: 999 } as any);

    return { service, createAutoEntry, accountMapping };
  };

  it('posts the mirror reversal (DR 4175 + DR taxes per type, CR 1305) for IVA+INC breakdown', async () => {
    const { service, createAutoEntry } = createService();

    await service.onCreditNoteAccepted({
      invoice_id: 55,
      organization_id: 1,
      store_id: 2,
      accounting_entity_id: 77,
      subtotal: 1000,
      tax_amount: 270,
      tax_breakdown: [
        { tax_type: 'iva', tax_amount: 190 },
        { tax_type: 'inc', tax_amount: 80 },
      ],
      total: 1270,
      user_id: 9,
    });

    expect(createAutoEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'credit_note.accepted',
        source_id: 55,
        organization_id: 1,
        store_id: 2,
        accounting_entity_id: 77,
        user_id: 9,
      }),
    );

    const lines = createAutoEntry.mock.calls[0][0].lines.filter(Boolean);

    // DR sales returns for the subtotal (contra-revenue, never CR 4135).
    expect(lines).toContainEqual(
      expect.objectContaining({
        account_code: '4175',
        debit_amount: 1000,
        credit_amount: 0,
      }),
    );
    // DR each tax liability on its own typed account.
    expect(lines).toContainEqual(
      expect.objectContaining({
        account_code: '2408',
        debit_amount: 190,
        credit_amount: 0,
      }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        account_code: '2436',
        debit_amount: 80,
        credit_amount: 0,
      }),
    );
    // CR accounts receivable for the full total.
    expect(lines).toContainEqual(
      expect.objectContaining({
        account_code: '1305',
        debit_amount: 0,
        credit_amount: 1270,
      }),
    );

    // The entry must balance within the createAutoEntry tolerance (0.001).
    const total_debit = lines.reduce(
      (sum: number, l: any) => sum + l.debit_amount,
      0,
    );
    const total_credit = lines.reduce(
      (sum: number, l: any) => sum + l.credit_amount,
      0,
    );
    expect(Math.abs(total_debit - total_credit)).toBeLessThanOrEqual(0.001);
  });

  it('falls back to a single IVA debit line when no typed breakdown is present', async () => {
    const { service, createAutoEntry } = createService();

    await service.onCreditNoteAccepted({
      invoice_id: 56,
      organization_id: 1,
      store_id: 2,
      subtotal: 1000,
      tax_amount: 190,
      total: 1190,
    });

    const lines = createAutoEntry.mock.calls[0][0].lines.filter(Boolean);
    const tax_lines = lines.filter((l: any) => l.account_code === '2408');
    expect(tax_lines).toHaveLength(1);
    expect(tax_lines[0]).toEqual(
      expect.objectContaining({ debit_amount: 190, credit_amount: 0 }),
    );

    const total_debit = lines.reduce(
      (sum: number, l: any) => sum + l.debit_amount,
      0,
    );
    const total_credit = lines.reduce(
      (sum: number, l: any) => sum + l.credit_amount,
      0,
    );
    expect(Math.abs(total_debit - total_credit)).toBeLessThanOrEqual(0.001);
  });
});
