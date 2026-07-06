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
    const entryFailure = {
      recordFailure: jest.fn(),
      ...overrides.entryFailure,
    };

    const service = new AutoEntryService(
      prisma as any,
      accountMapping as any,
      fiscalScope as any,
      fiscalGate as any,
      entryFailure as any,
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

describe('AutoEntryService VAT settlement lifecycle (F5 + 2a/2b)', () => {
  // PUC leaves the VAT settlement lines resolve to (buildVatSettlementLines).
  const VAT_MAPPING_CODES: Record<string, string> = {
    'vat.declaration.settled.iva_generated': '240802',
    'vat.declaration.settled.iva_deductible': '240804',
    'vat.declaration.settled.vat_payable': '240810',
    'vat.declaration.settled.vat_favor': '135520',
  };

  // Net signed amount per account across a set of lines (debit positive).
  // Tolerates both shapes: payload AutoEntryLine (`account_code`) and the
  // Prisma-shaped persisted line (`account.code`).
  const netByCode = (lines: any[]): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const l of lines.filter(Boolean)) {
      const code = l.account_code ?? l.account?.code;
      map[code] =
        (map[code] || 0) + Number(l.debit_amount) - Number(l.credit_amount);
    }
    return map;
  };

  const balances = (lines: any[]) => {
    const net = netByCode(lines);
    const sum = Object.values(net).reduce((s, v) => s + v, 0);
    return Math.abs(sum) <= 0.001;
  };

  const createVatService = (
    opts: { previousEntry?: any; entityId?: number } = {},
  ) => {
    const entityId = opts.entityId ?? 77;
    const accEntriesFindFirst = jest
      .fn()
      .mockResolvedValue(opts.previousEntry ?? null);
    const prisma = {
      accounting_entries: { findFirst: accEntriesFindFirst },
      withoutScope: () => ({
        accounting_entities: {
          findFirst: jest.fn().mockResolvedValue({ id: entityId }),
        },
      }),
    };
    const accountMapping = {
      getMapping: jest.fn(async (_org: number, mapping_key: string) =>
        VAT_MAPPING_CODES[mapping_key]
          ? { account_code: VAT_MAPPING_CODES[mapping_key], source: 'default' }
          : null,
      ),
    };
    const fiscalScope = {
      resolveAccountingEntityForFiscal: jest
        .fn()
        .mockResolvedValue({ id: entityId }),
    };
    const fiscalGate = { isAreaEnabled: jest.fn().mockResolvedValue(true) };
    const entryFailure = { recordFailure: jest.fn() };

    const service = new AutoEntryService(
      prisma as any,
      accountMapping as any,
      fiscalScope as any,
      fiscalGate as any,
      entryFailure as any,
    );
    const createAutoEntry = jest
      .spyOn(service, 'createAutoEntry')
      .mockResolvedValue({ id: 999 } as any);

    return { service, createAutoEntry, accEntriesFindFirst };
  };

  // A settlement entry as onVatSettlement would have posted it:
  // DR 240802 generado / CR 240804 descontable / CR 240810 neto a pagar.
  const settlementEntry = (
    id: number,
    generated: number,
    deductible: number,
  ) => {
    const balance = generated - deductible;
    const lines: any[] = [
      { debit_amount: generated, credit_amount: 0, account: { code: '240802' } },
      {
        debit_amount: 0,
        credit_amount: deductible,
        account: { code: '240804' },
      },
    ];
    if (balance > 0.001) {
      lines.push({
        debit_amount: 0,
        credit_amount: balance,
        account: { code: '240810' },
      });
    } else if (balance < -0.001) {
      lines.push({
        debit_amount: -balance,
        credit_amount: 0,
        account: { code: '135520' },
      });
    }
    return { id, accounting_entry_lines: lines };
  };

  // (i) approve → submit → reject → re-approve ⇒ net = L (NOT 0, NO correction).
  // 2a removed the reversal on reject, so a re-approval with the SAME amounts
  // must fall to the normal 'vat_declaration' path (dedup), never post a
  // correction. The ledger keeps the original settlement L.
  it('re-approval with unchanged amounts posts a plain vat_declaration (no correction)', async () => {
    const { service, createAutoEntry } = createVatService({
      previousEntry: settlementEntry(500, 1900, 1140),
    });

    await service.onVatSettlement({
      declaration_id: 42,
      organization_id: 1,
      store_id: 2,
      accounting_entity_id: 77,
      generated_tax_amount: 1900,
      deductible_tax_amount: 1140,
      period_end: new Date('2026-06-30T00:00:00Z'),
      user_id: 9,
    });

    expect(createAutoEntry).toHaveBeenCalledTimes(1);
    const payload = createAutoEntry.mock.calls[0][0];
    expect(payload.source_type).toBe('vat_declaration');
    expect(payload.source_id).toBe(42);
    // net L on the settlement: DR 240802 1900 / CR 240804 1140 / CR 240810 760.
    const net = netByCode(payload.lines);
    expect(net['240802']).toBeCloseTo(1900, 3);
    expect(net['240804']).toBeCloseTo(-1140, 3);
    expect(net['240810']).toBeCloseTo(-760, 3);
    expect(balances(payload.lines)).toBe(true);
  });

  // First approval (no previous entry) posts the plain settlement L.
  it('first approval posts the plain vat_declaration settlement L', async () => {
    const { service, createAutoEntry } = createVatService({
      previousEntry: null,
    });

    await service.onVatSettlement({
      declaration_id: 43,
      organization_id: 1,
      store_id: 2,
      accounting_entity_id: 77,
      generated_tax_amount: 1900,
      deductible_tax_amount: 1140,
      period_end: new Date('2026-06-30T00:00:00Z'),
    });

    expect(createAutoEntry).toHaveBeenCalledTimes(1);
    expect(createAutoEntry.mock.calls[0][0].source_type).toBe(
      'vat_declaration',
    );
    expect(balances(createAutoEntry.mock.calls[0][0].lines)).toBe(true);
  });

  // (ii) approve → void ⇒ net = 0. onVatSettlementReversed posts the exact
  // mirror (DR↔CR swapped); original + reversal cancel to zero per account.
  it('void posts the mirror reversal that nets the settlement to 0', async () => {
    const { service, createAutoEntry } = createVatService({
      previousEntry: { id: 500 },
    });

    await service.onVatSettlementReversed({
      declaration_id: 44,
      organization_id: 1,
      store_id: 2,
      accounting_entity_id: 77,
      generated_tax_amount: 1900,
      deductible_tax_amount: 1140,
      period_end: new Date('2026-06-30T00:00:00Z'),
    });

    expect(createAutoEntry).toHaveBeenCalledTimes(1);
    const payload = createAutoEntry.mock.calls[0][0];
    expect(payload.source_type).toBe('vat_declaration_reversal');
    // Mirror of the settlement: CR 240802 1900 / DR 240804 1140 / DR 240810 760.
    const net = netByCode(payload.lines);
    expect(net['240802']).toBeCloseTo(-1900, 3);
    expect(net['240804']).toBeCloseTo(1140, 3);
    expect(net['240810']).toBeCloseTo(760, 3);
    expect(balances(payload.lines)).toBe(true);
    // Original L + reversal (-L) = 0 per account.
    const original = netByCode(settlementEntry(500, 1900, 1140).accounting_entry_lines);
    for (const code of Object.keys(net)) {
      expect(net[code] + (original[code] || 0)).toBeCloseTo(0, 3);
    }
  });

  // (iii) reject → recalcular-con-monto-nuevo → re-approve ⇒ net = L'.
  // The existing settlement (1900/1140) differs from the re-approved amounts
  // (2000/1000), so a vat_declaration_correction is posted whose net = new−old.
  it('re-approval after recalc posts a correction netting to (new − old)', async () => {
    const { service, createAutoEntry } = createVatService({
      previousEntry: settlementEntry(500, 1900, 1140),
    });

    await service.onVatSettlement({
      declaration_id: 45,
      organization_id: 1,
      store_id: 2,
      accounting_entity_id: 77,
      generated_tax_amount: 2000,
      deductible_tax_amount: 1000,
      period_end: new Date('2026-06-30T00:00:00Z'),
      user_id: 9,
    });

    expect(createAutoEntry).toHaveBeenCalledTimes(1);
    const payload = createAutoEntry.mock.calls[0][0];
    expect(payload.source_type).toBe('vat_declaration_correction');
    expect(payload.source_id).toBe(45);
    expect(payload.accounting_entity_id).toBe(77);

    const net = netByCode(payload.lines);
    // 240802: new gen 2000 − old gen 1900 = +100 (debit).
    expect(net['240802']).toBeCloseTo(100, 3);
    // 240804: deductible dropped 1140→1000 ⇒ +140 debit (less credit balance).
    expect(net['240804']).toBeCloseTo(140, 3);
    // 240810: payable rose 760→1000 ⇒ +240 credit.
    expect(net['240810']).toBeCloseTo(-240, 3);
    // The correction is self-balanced.
    expect(balances(payload.lines)).toBe(true);
    // original L + correction (L'−L) = new L' per account.
    const original = netByCode(settlementEntry(500, 1900, 1140).accounting_entry_lines);
    const finalLedger: Record<string, number> = { ...original };
    for (const code of Object.keys(net)) {
      finalLedger[code] = (finalLedger[code] || 0) + net[code];
    }
    // L' = DR 240802 2000 / CR 240804 1000 / CR 240810 1000.
    expect(finalLedger['240802']).toBeCloseTo(2000, 3);
    expect(finalLedger['240804']).toBeCloseTo(-1000, 3);
    expect(finalLedger['240810']).toBeCloseTo(-1000, 3);
  });
});
