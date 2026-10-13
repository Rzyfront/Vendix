import { InvoiceFlowService } from './invoice-flow.service';
import { CreditNoteBalanceService } from '../credit-notes/credit-note-balance.service';
import { RequestContextService } from '../../../../common/context/request-context.service';

const source = {
  id: 700,
  organization_id: 1,
  store_id: 2,
  accounting_entity_id: 3,
  invoice_type: 'sales_invoice',
  status: 'accepted',
  invoice_items: [],
  invoice_taxes: [],
  total_amount: '119.00',
  tax_amount: '19.00',
};
const creditNote = {
  id: 71,
  organization_id: 1,
  store_id: 2,
  accounting_entity_id: 3,
  invoice_type: 'credit_note',
  related_invoice_id: source.id,
  invoice_number: null,
  status: 'draft',
  issue_date: new Date('2026-10-01T12:00:00Z'),
  invoice_items: [{
    id: 72,
    invoice_id: 71,
    source_invoice_item_id: 7001,
    quantity: '1.0000',
    unit_price: '100.00',
    discount_amount: '0.00',
    tax_amount: '19.00',
    total_amount: '119.00',
  }],
  invoice_taxes: [],
  subtotal_amount: '100.00',
  discount_amount: '0.00',
  tax_amount: '19.00',
  total_amount: '119.00',
  withholding_amount: '0.00',
};

function createFlow(invoice: any, overrides: Record<string, any> = {}) {
  const prisma = {
    invoices: {
      findFirst: jest.fn().mockResolvedValue(invoice),
      update: jest.fn().mockImplementation(({ data }: any) => ({ ...invoice, ...data })),
    },
    dian_document_events: { findFirst: jest.fn().mockResolvedValue(null) },
    withoutScope: () => ({ dian_configurations: { findFirst: jest.fn().mockResolvedValue(null) } }),
    ...overrides.prisma,
  };
  const resolver = { resolve: jest.fn().mockResolvedValue({ sendCreditNote: jest.fn(), sendDebitNote: jest.fn() }), ...overrides.resolver };
  const retryQueue = { enqueue: jest.fn(), ...overrides.retryQueue };
  const fiscalLedger = {
    ensureInvoiceTransmission: jest.fn().mockResolvedValue({ id: 800 }),
    claimSubmission: jest.fn(), markRejected: jest.fn(), markAccepted: jest.fn(), markError: jest.fn(),
    ...overrides.fiscalLedger,
  };
  const balance = {
    assertNoteBeforeNumbering: jest.fn().mockResolvedValue(undefined),
    reserveValidation: jest.fn().mockResolvedValue({ ...invoice, status: 'validated' }),
    ensureForSend: jest.fn().mockResolvedValue(undefined),
    transition: jest.fn().mockImplementation((_id, data) => ({ ...invoice, ...data })),
    ...overrides.balance,
  } as unknown as jest.Mocked<CreditNoteBalanceService>;
  const numberGenerator = {
    generateNextNumber: jest.fn().mockResolvedValue({ invoice_number: 'NC-1', resolution_id: 9 }),
  };
  const service = new InvoiceFlowService(
    prisma as any,
    resolver as any,
    { emit: jest.fn(), emitAsync: jest.fn() } as any,
    retryQueue as any,
    fiscalLedger as any,
    { isAreaEnabled: jest.fn().mockResolvedValue(true), isSubflowEnabled: jest.fn().mockResolvedValue(true) } as any,
    {} as any,
    { validate: jest.fn().mockReturnValue({ emittable: true, blockers: [], warnings: [] }) } as any,
    {} as any,
    {} as any,
    numberGenerator as any,
    balance,
  );
  return { service, prisma, balance, numberGenerator, fiscalLedger, resolver };
}

describe('InvoiceFlowService note source limits and durable reservation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('checks a numberless credit note through the persisted-source resolver before numbering', async () => {
    const { service, balance, numberGenerator, prisma } = createFlow(creditNote);
    jest.spyOn(service as any, 'assertOrderPaidForEmission').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'assertFiscalPeriodOpen').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'assertDraftArithmeticClosable').mockReturnValue(undefined);
    jest.spyOn(service as any, 'assertFiscalDocumentEmittable').mockResolvedValue(undefined);
    const identity = (service as any).acquirerIdentity;
    identity.validate.mockReturnValue({ emittable: true, blockers: [], warnings: [] });

    await service.validate(creditNote.id);

    expect(balance.assertNoteBeforeNumbering).toHaveBeenCalledTimes(1);
    expect(balance.assertNoteBeforeNumbering).toHaveBeenCalledWith(creditNote.id);
    expect(balance.assertNoteBeforeNumbering.mock.invocationCallOrder[0]).toBeLessThan(numberGenerator.generateNextNumber.mock.invocationCallOrder[0]);
    expect(balance.reserveValidation).toHaveBeenCalledWith(creditNote.id, expect.any(Object));
    expect(prisma.invoices.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ invoice_number: 'NC-1' }) }));
    expect(prisma.invoices.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'validated' } }));
  });

  it('propagates persisted-source resolution failure without numbering a credit or debit note', async () => {
    for (const note of [creditNote, { ...creditNote, id: 73, invoice_type: 'debit_note' }]) {
      const { service, balance, numberGenerator } = createFlow(note, {
        balance: {
          assertNoteBeforeNumbering: jest.fn().mockRejectedValue(
            Object.assign(new Error('source could not be reconstructed'), {
              errorCode: 'INVOICING_NOTE_SOURCE_001',
            }),
          ),
        },
      });
      jest.spyOn(service as any, 'assertOrderPaidForEmission').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'assertFiscalPeriodOpen').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'assertDraftArithmeticClosable').mockReturnValue(undefined);
      jest.spyOn(service as any, 'assertFiscalDocumentEmittable').mockResolvedValue(undefined);

      await expect(service.validate(note.id)).rejects.toMatchObject({ errorCode: 'INVOICING_NOTE_SOURCE_001' });
      expect(balance.assertNoteBeforeNumbering).toHaveBeenCalledWith(note.id);
      expect(numberGenerator.generateNextNumber).not.toHaveBeenCalled();
    }
  });

  it('runs the same persisted-source proof before numbering a numberless debit note', async () => {
    const debitNote = { ...creditNote, id: 73, invoice_type: 'debit_note' };
    const { service, balance, numberGenerator } = createFlow(debitNote);
    jest.spyOn(service as any, 'assertOrderPaidForEmission').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'assertFiscalPeriodOpen').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'assertDraftArithmeticClosable').mockReturnValue(undefined);
    jest.spyOn(service as any, 'assertFiscalDocumentEmittable').mockResolvedValue(undefined);
    (service as any).acquirerIdentity.validate.mockReturnValue({ emittable: true, blockers: [], warnings: [] });

    await service.validate(debitNote.id);

    expect(balance.assertNoteBeforeNumbering).toHaveBeenCalledWith(debitNote.id);
    expect(balance.assertNoteBeforeNumbering.mock.invocationCallOrder[0]).toBeLessThan(numberGenerator.generateNextNumber.mock.invocationCallOrder[0]);
  });

  it('keeps a manual rejection unreserved and releases only on safe cancel/void transitions', async () => {
    const { service, balance } = createFlow({ ...creditNote, status: 'validated', invoice_number: 'NC-1' });
    jest.spyOn(service as any, 'assertFiscalPeriodOpen').mockResolvedValue(undefined);

    await service.reject(creditNote.id);
    expect(balance.transition).toHaveBeenCalledWith(
      creditNote.id,
      expect.objectContaining({ status: 'rejected' }),
      expect.any(Object),
      'none',
      'validated',
    );

    balance.transition.mockClear();
    await service.cancel(creditNote.id);
    expect(balance.transition).toHaveBeenCalledWith(creditNote.id, { status: 'cancelled' }, expect.any(Object), 'pretransmission_cancel', 'validated');
  });

  it('checks source balance before fiscal-ledger submission and provider I/O', async () => {
    const { service, balance, fiscalLedger, resolver, prisma } = createFlow({
      ...creditNote,
      status: 'validated',
      invoice_number: 'NC-1',
      resolution: { id: 9, resolution_number: 'R1', prefix: 'NC', range_from: 1, range_to: 100, valid_from: new Date('2026-01-01'), valid_to: new Date('2027-01-01') },
      issue_date: new Date('2026-10-01T12:00:00Z'),
      customer_name: 'Cliente',
      customer_tax_id: '123456789',
      customer_document_type: '31',
      customer_person_type: 'JURIDICA',
      invoice_items: [{ ...creditNote.invoice_items[0], unit_code: 'NIU', product_id: null }],
    }, {
      fiscalLedger: { ensureInvoiceTransmission: jest.fn().mockRejectedValue(new Error('ledger reached')) },
    });
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ user_id: 9, organization_id: 1, store_id: 2 } as any);
    jest.spyOn(service as any, 'assertInvoicingAreaActive').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'assertOrderPaidForEmission').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'assertFiscalPeriodOpen').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'resolveTimezone').mockResolvedValue('America/Bogota');
    jest.spyOn(service as any, 'resolveLineUnitCodes').mockResolvedValue(new Map());
    jest.spyOn(service as any, 'assertLineUnitCodesResolved').mockReturnValue(undefined);
    jest.spyOn(service as any, 'resolveAiuEmissionContext').mockResolvedValue(null);
    jest.spyOn(service as any, 'resolveWithholdingBatches').mockResolvedValue([]);
    jest.spyOn(service as any, 'resolveInclusiveLineOverrides').mockReturnValue(new Map());
    jest.spyOn(service as any, 'resolveEmittedPriceUnitQuantity').mockReturnValue(1);
    jest.spyOn(service as any, 'revealResolutionTechnicalKey').mockResolvedValue(null);
    jest.spyOn(service as any, 'resolveTransmissionConfigId').mockResolvedValue(null);
    jest.spyOn(service as any, 'toProviderWithholdings').mockReturnValue([]);
    jest.spyOn(service as any, 'attachLineTaxes').mockReturnValue(undefined);
    jest.spyOn(service as any, 'configurationType').mockReturnValue('sales_invoice');
    jest.spyOn(service as any, 'assertProviderSupports').mockReturnValue(undefined);
    resolver.resolve.mockResolvedValue({ sendCreditNote: jest.fn(), sendDebitNote: jest.fn() } as any);
    prisma.invoices.findFirst.mockResolvedValueOnce({ ...creditNote, status: 'validated', invoice_number: 'NC-1' }).mockResolvedValue({ id: source.id });

    await expect(service.send(creditNote.id)).rejects.toThrow('ledger reached');
    expect(balance.ensureForSend).toHaveBeenCalledWith(creditNote.id);
    expect(balance.ensureForSend.mock.invocationCallOrder[0]).toBeLessThan(fiscalLedger.ensureInvoiceTransmission.mock.invocationCallOrder[0]);
    expect(resolver.resolve).toHaveBeenCalled();
  });

  it('routes accepted credit-note persistence through balance transition without a second cap check', async () => {
    const { service, balance } = createFlow(creditNote);
    await (service as any).persistAcceptedInvoiceAndContract(creditNote, { status: 'accepted', dian_status: 'accepted' });
    expect(balance.transition).toHaveBeenCalledWith(
      creditNote.id,
      { status: 'accepted', dian_status: 'accepted' },
      expect.any(Object),
      'none',
    );
    expect(balance.assertNoteBeforeNumbering).not.toHaveBeenCalled();
  });
});
