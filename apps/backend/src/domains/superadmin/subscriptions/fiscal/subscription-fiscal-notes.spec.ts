import { SubscriptionFiscalService } from './subscription-fiscal.service';

/**
 * Platform credit/debit notes in SubscriptionFiscalService: numbering per
 * document type (sales_invoice untouched) and issuePlatformNote emission.
 * Only the collaborators these paths touch are real or mocked; the rest of the
 * 18 constructor dependencies are empty objects.
 */
const TECHNICAL_KEY = 'a'.repeat(64);

const salesResolution = () => ({
  id: 77,
  resolution_number: '18760000001',
  prefix: 'FE',
  range_from: 1,
  range_to: 1000,
  current_number: 0,
  is_active: true,
  technical_key: TECHNICAL_KEY,
  document_type: 'sales_invoice',
});
const noteResolution = (type: 'credit_note' | 'debit_note') => ({
  id: type === 'credit_note' ? 90 : 91,
  resolution_number: 'INTERNA-NC',
  prefix: type === 'credit_note' ? 'NC' : 'ND',
  range_from: 1,
  range_to: 100000,
  current_number: 4,
  is_active: true,
  technical_key: null,
  document_type: type,
  valid_from: new Date('2020-01-01'),
  valid_to: new Date('2099-01-01'),
});

const settings = {
  is_enabled: true,
  auto_issue: false,
  environment: 'test',
  platform_organization_id: 1,
  accounting_entity_id: 5,
  dian_configuration_id: 9,
  invoice_resolution_id: 77,
};

function makeTx(resolution: any | null) {
  return {
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    invoice_resolutions: {
      findFirst: jest.fn().mockResolvedValue(resolution),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockImplementation(async () =>
        resolution ? { ...resolution, current_number: resolution.current_number + 1 } : null,
      ),
    },
  };
}

function makeService(over: { prisma?: any; dianProvider?: any; eventEmitter?: any } = {}) {
  const unused = {};
  const args: any[] = [
    over.prisma ?? {},
    unused,
    unused,
    over.dianProvider ?? unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    { reveal: (r: any) => r.technical_key ?? null },
    unused,
    unused,
    unused,
    over.eventEmitter ?? { emit: jest.fn() },
    unused,
  ];
  return Reflect.construct(SubscriptionFiscalService, args) as any;
}

describe('allocateFiscalNumber by document type', () => {
  it('sales_invoice keeps its lock key, resolution lookup and number', async () => {
    const svc = makeService();
    const tx = makeTx(salesResolution());
    const out = await svc.allocateFiscalNumber(tx, settings);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'invoice_resolution:5:sales_invoice',
    );
    expect(tx.invoice_resolutions.findFirst.mock.calls[0][0].where).toMatchObject({
      accounting_entity_id: 5,
      document_type: 'sales_invoice',
      id: 77,
    });
    expect(out.invoice_number).toBe('FE1');
  });

  it('credit_note locks its own key and numbers from the active credit series', async () => {
    const svc = makeService();
    const tx = makeTx(noteResolution('credit_note'));
    const out = await svc.allocateFiscalNumber(tx, settings, undefined, 'credit_note');
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'invoice_resolution:5:credit_note',
    );
    const where = tx.invoice_resolutions.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ document_type: 'credit_note', is_active: true });
    expect(where.id).toBeUndefined();
    expect(out.invoice_number).toBe('NC5');
  });

  it('debit_note numbers from the debit series', async () => {
    const svc = makeService();
    const tx = makeTx(noteResolution('debit_note'));
    const out = await svc.allocateFiscalNumber(tx, settings, undefined, 'debit_note');
    expect(out.invoice_number).toBe('ND5');
  });

  it('without an active note series says so and does not touch the cursor', async () => {
    const svc = makeService();
    const tx = makeTx(null);
    await expect(
      svc.allocateFiscalNumber(tx, settings, undefined, 'credit_note'),
    ).rejects.toMatchObject({
      errorCode: 'FISCAL_RESOLUTION_MISSING',
      message: expect.stringMatching(/serie activa/i),
    });
    expect(tx.invoice_resolutions.updateMany).not.toHaveBeenCalled();
  });
});

describe('issuePlatformNote', () => {
  const original = {
    id: 5,
    document_number: 'FV5',
    cufe: 'cufe-5',
    issue_date: '2026-11-01',
    total: '238.00',
    currency: 'COP',
    provider_data: {
      customer_name: 'Cliente SAS',
      customer_tax_id: '900123456',
      customer_email: 'c@x.co',
      payment_form: '1',
      payment_means: '42',
    },
    lines: [],
    customer: { legal_name: 'Cliente SAS', email: 'c@x.co' },
    tax_breakdown: [],
    counterpart_account_code: '130505',
  };
  const computation = (total = '119.00') => ({
    lineItems: [{ description: 'x', quantity: '1', unit_price: '100.00' }],
    snapshotItems: [{ description: 'x', quantity: 1, unit_price: 100 }],
    subtotal: '100.00',
    taxTotal: '19.00',
    discountTotal: '0.00',
    payable: total,
    hasAnyTax: true,
    taxBreakdown: [{ tax_type: 'IVA', rate: 0.19, base: '100.00', amount: '19.00' }],
  });

  function harness(opts: { type: 'credit_note' | 'debit_note'; credited?: string[]; accepted?: boolean }) {
    const created: any[] = [];
    const evidences: any[] = [];
    const tx: any = {
      ...makeTx(noteResolution(opts.type)),
      fiscal_transmissions: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest
          .fn()
          .mockResolvedValue((opts.credited ?? []).map((_, i) => ({ id: 100 + i }))),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          created.push(data);
          return { id: 77, organization_id: 1, store_id: null, accounting_entity_id: 5, ...data };
        }),
      },
      fiscal_evidences: {
        findMany: jest.fn().mockResolvedValue(
          (opts.credited ?? []).map((t, i) => ({
            fiscal_transmission_id: 100 + i,
            metadata: { kind: 'platform_invoice_snapshot', totals: { total: Number(t) } },
          })),
        ),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          evidences.push(data);
          return data;
        }),
      },
    };
    const final = {
      id: 77,
      document_type: opts.type,
      source_type: opts.type === 'credit_note' ? 'platform_credit_note' : 'platform_debit_note',
      document_number: opts.type === 'credit_note' ? 'NC5' : 'ND5',
      transmission_status: 'accepted',
      dian_status: 'accepted',
      cude: 'cude-1',
      error_code: null,
      error_message: null,
      organization_id: 1,
      store_id: null,
      accounting_entity_id: 5,
      created_by_user_id: null,
      related_transmission_id: 5,
    };
    const db: any = {
      fiscal_transmissions: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(final),
        findUnique: jest.fn().mockResolvedValue(final),
        findFirst: jest.fn().mockResolvedValue({ document_number: 'FV5' }),
      },
      fiscal_evidences: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({
          metadata: {
            kind: 'platform_invoice_snapshot',
            totals: { subtotal: 100, tax_amount: 19, total: 119 },
            tax_breakdown: [{ tax_type: 'IVA', rate: 0.19, base: 100, amount: 19 }],
            items: [],
          },
        }),
      },
    };
    const prisma = { withoutScope: () => db, $transaction: jest.fn(async (cb: any) => cb(tx)) };
    const response = {
      success: opts.accepted !== false,
      cude: 'cude-1',
      xml_document: '<xml/>',
      message: 'ok',
    };
    const dianProvider = {
      sendCreditNote: jest.fn().mockResolvedValue(response),
      sendDebitNote: jest.fn().mockResolvedValue(response),
    };
    const eventEmitter = { emit: jest.fn() };
    const svc = makeService({ prisma, dianProvider, eventEmitter });
    jest.spyOn(svc, 'getSettings').mockResolvedValue(settings);
    jest.spyOn(svc, 'assertPlatformSigningReady').mockResolvedValue(undefined);
    svc.persistence = {
      loadInvoiceSnapshot: jest.fn().mockResolvedValue({
        totals: { subtotal: 100, tax_amount: 19, total: 119 },
        items: [],
        withholdings: [],
        customer: { legal_name: 'Cliente SAS' },
        counterpart_account_code: '130505',
      }),
    };
    return { svc, tx, created, evidences, dianProvider, eventEmitter, db };
  }

  it('credit note: numbers from the credit series and sends the original reference', async () => {
    const h = harness({ type: 'credit_note' });
    const r = await h.svc.issuePlatformNote({
      note_type: 'credit_note',
      original,
      computation: computation(),
      is_total: false,
      note_concept_code: '3',
      reason: 'Descuento pactado',
      actor_user_id: 1,
    });
    expect(h.created[0]).toMatchObject({
      document_type: 'credit_note',
      source_type: 'platform_credit_note',
      related_transmission_id: 5,
      document_number: 'NC5',
    });
    const sent = h.dianProvider.sendCreditNote.mock.calls[0][0];
    expect(sent).toMatchObject({
      invoice_number: 'NC5',
      invoice_type: 'credit_note',
      original_invoice_number: 'FV5',
      original_invoice_cufe: 'cufe-5',
      original_invoice_issue_date: '2026-11-01',
      note_concept_code: '3',
      notes: 'Descuento pactado',
      customer_name: 'Cliente SAS',
      total_amount: '119.00',
    });
    expect(h.dianProvider.sendDebitNote).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      transmission_id: 77,
      document_type: 'credit_note',
      related_transmission_id: 5,
      related_document_number: 'FV5',
      dian_status: 'accepted',
      cude: 'cude-1',
      total: '119.00',
    });
  });

  it('debit note goes through sendDebitNote with the debit series', async () => {
    const h = harness({ type: 'debit_note' });
    await h.svc.issuePlatformNote({
      note_type: 'debit_note',
      original,
      computation: computation(),
      is_total: false,
      note_concept_code: '1',
      reason: 'Intereses',
      actor_user_id: 1,
    });
    expect(h.created[0]).toMatchObject({ document_type: 'debit_note', source_type: 'platform_debit_note' });
    expect(h.dianProvider.sendDebitNote).toHaveBeenCalledTimes(1);
    expect(h.dianProvider.sendCreditNote).not.toHaveBeenCalled();
  });

  it('accepted credit note emits the accounting event as a credit note and the delivery event', async () => {
    const h = harness({ type: 'credit_note' });
    await h.svc.issuePlatformNote({
      note_type: 'credit_note', original, computation: computation(), is_total: false,
      note_concept_code: '3', reason: 'r', actor_user_id: 1,
    });
    const events = h.eventEmitter.emit.mock.calls.map((c: any[]) => c[0]);
    expect(events).toEqual(['invoice.accepted', 'platform_note.accepted']);
    expect(h.eventEmitter.emit.mock.calls[0][1]).toMatchObject({
      invoice_id: 77,
      invoice_type: 'credit_note',
      invoice_number: 'NC5',
      subtotal_amount: 100,
      tax_amount: 19,
      total_amount: 119,
    });
  });

  it('a rejected note stays rejected and emits no accounting event', async () => {
    const h = harness({ type: 'credit_note', accepted: false });
    await h.svc.issuePlatformNote({
      note_type: 'credit_note', original, computation: computation(), is_total: false,
      note_concept_code: '3', reason: 'r', actor_user_id: 1,
    });
    expect(h.eventEmitter.emit).not.toHaveBeenCalled();
    expect(h.db.fiscal_transmissions.update.mock.calls[0][0].data).toMatchObject({
      transmission_status: 'rejected',
    });
  });

  it('re-checks the balance under the lock and burns no number when it is exceeded', async () => {
    const h = harness({ type: 'credit_note', credited: ['200.00'] });
    await expect(
      h.svc.issuePlatformNote({
        note_type: 'credit_note', original, computation: computation('119.00'), is_total: false,
        note_concept_code: '3', reason: 'r', actor_user_id: 1,
      }),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_CREDIT_NOTE_001' });
    expect(h.tx.$executeRawUnsafe.mock.calls[0][1]).toBe('platform_note_balance:5');
    expect(h.tx.invoice_resolutions.updateMany).not.toHaveBeenCalled();
    expect(h.dianProvider.sendCreditNote).not.toHaveBeenCalled();
  });

  it('resendPlatformNote refuses a note already accepted by DIAN', async () => {
    const h = harness({ type: 'credit_note' });
    h.db.fiscal_transmissions.findFirst = jest.fn().mockResolvedValue({
      id: 90, document_number: 'NC9', document_type: 'credit_note',
      source_type: 'platform_credit_note', dian_status: 'accepted', related_transmission_id: 5,
    });
    await expect(h.svc.resendPlatformNote(90)).rejects.toMatchObject({
      errorCode: 'INVOICING_STATUS_002',
    });
    expect(h.dianProvider.sendCreditNote).not.toHaveBeenCalled();
  });
});
