import { InvoiceHolderChangesService } from './invoice-holder-changes.service';
import { CustomerFiscalIdentityValidator } from '../validators/customer-fiscal-identity.validator';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { holderEconomicHash } from './invoice-holder-change.types';
import { Prisma } from '@prisma/client';
import { VendixHttpException } from '../../../../common/errors';

describe('durable holder change invariants', () => {
  const context = { store_id: 3, organization_id: 7 };
  const snapshot: any = {
    person_type: 'NATURAL',
    document_type: 'CC',
    document_number: '10852746',
    first_name: 'Rafael',
    last_name: 'Perez',
    email: 'rafa@example.com',
    address: {
      address_line1: 'Carrera 1 # 2',
      city: 'Bogotá',
      state_province: 'Bogotá',
      municipality_code: '11001',
      country_code: 'CO',
    },
  };
  function harness() {
    const prisma: any = {
      invoice_holder_changes: { findFirst: jest.fn(), updateMany: jest.fn() },
      invoice_data_requests: { findFirst: jest.fn() },
      invoices: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const notes: any = { createHolderChangeCreditNote: jest.fn() };
    const flow: any = {
      refreshHolderFiscalStatus: jest.fn(),
      reconcileAcceptedFromLedger: jest.fn(),
      send: jest.fn(),
      validate: jest.fn(),
    };
    const ledger: any = { findAcceptedInvoiceTransmission: jest.fn() };
    const service = new InvoiceHolderChangesService(
      prisma,
      notes,
      flow,
      ledger,
      {} as any,
      new CustomerFiscalIdentityValidator(),
      {} as any,
      { isAdmissionEnabled: () => false } as any,
      {} as any,
      {} as any,
    );
    return { prisma, notes, flow, ledger, service };
  }
  beforeEach(() =>
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(context as any),
  );
  afterEach(() => jest.restoreAllMocks());
  it('accepts complete natural capture but blocks missing email/municipality and CF sentinel', () => {
    const { service } = harness();
    expect(() => service.validateSnapshot(snapshot)).not.toThrow();
    for (const bad of [
      { ...snapshot, email: '' },
      { ...snapshot, address: { ...snapshot.address, municipality_code: '' } },
      { ...snapshot, document_number: '222222222222' },
    ])
      expect(() => service.validateSnapshot(bad)).toThrow();
  });
  it('same public submission reuses its operation after original unlink and even with admission off', async () => {
    const { service, prisma } = harness();
    prisma.invoice_data_requests.findFirst.mockResolvedValue({
      id: 8,
      invoice_id: 10,
      submission_hash: 'same',
    });
    prisma.invoice_holder_changes.findFirst.mockResolvedValue({
      id: 21,
      request_id: 8,
    });
    jest.spyOn(service, 'resume').mockResolvedValue({ id: 21 } as any);
    await expect(service.startPublic(8, 3, snapshot, 'same')).resolves.toEqual({
      id: 21,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await expect(
      service.startPublic(8, 3, snapshot, 'different'),
    ).rejects.toMatchObject({ errorCode: 'CF_HOLDER_SUBMISSION_CONFLICT' });
  });
  it('lost lease does not create/send another document', async () => {
    const { service, prisma, notes, flow } = harness();
    prisma.invoice_holder_changes.findFirst.mockResolvedValue({
      id: 21,
      store_id: 3,
      organization_id: 7,
      phase: 'waiting_credit_note_dian',
    });
    prisma.invoice_holder_changes.updateMany.mockResolvedValue({ count: 0 });
    jest
      .spyOn(service, 'getOperation')
      .mockResolvedValue({ id: 21, run_status: 'running' } as any);
    await expect(service.resume(21)).resolves.toMatchObject({
      run_status: 'running',
    });
    expect(notes.createHolderChangeCreditNote).not.toHaveBeenCalled();
    expect(flow.send).not.toHaveBeenCalled();
  });
  it('identical manual replay resumes the operation even with admissions disabled', async () => {
    const { service, prisma } = harness();
    prisma.invoice_holder_changes.findFirst.mockResolvedValue({
      id: 21,
      request_id: null,
      mode: 'manual',
      reason: 'Corregir titular',
    });
    jest.spyOn(service, 'resume').mockResolvedValue({ id: 21 } as any);
    await expect(
      service.startManual(10, '  Corregir titular  '),
    ).resolves.toEqual({ id: 21 });
    await expect(service.startManual(10, 'Otro motivo')).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('checkpoint rejects a stale version without changing request state or auditing', async () => {
    const { service, prisma } = harness();
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 4 }]),
      invoice_holder_changes: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      invoice_data_requests: { updateMany: jest.fn() },
      fiscal_operation_events: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    const op = {
      id: 21,
      store_id: 3,
      organization_id: 7,
      original_order_id: 4,
      request_id: 8,
      version: 5,
      lease_owner: 'worker-1',
    };
    await expect(
      (service as any).checkpoint(op, 'fiscal_completed'),
    ).resolves.toBe(false);
    expect(tx.invoice_holder_changes.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          version: 5,
          lease_owner: 'worker-1',
          lease_expires_at: { gt: expect.any(Date) },
        }),
      }),
    );
    expect(tx.invoice_data_requests.updateMany).not.toHaveBeenCalled();
    expect(tx.fiscal_operation_events.create).not.toHaveBeenCalled();
  });
  it('transient domain 5xx stays retryable instead of requiring user intervention', async () => {
    const { service, prisma } = harness();
    let owner: string;
    prisma.invoice_holder_changes.updateMany.mockImplementation(
      async ({ data }: any) => {
        if (data.lease_owner) owner = data.lease_owner;
        return { count: 1 };
      },
    );
    prisma.invoice_holder_changes.findFirst.mockImplementation(async () => ({
      id: 21,
      store_id: 3,
      organization_id: 7,
      phase: 'waiting_credit_note_dian',
      attempt_count: 0,
      lease_owner: owner,
      lease_expires_at: new Date(Date.now() + 120000),
    }));
    jest.spyOn(service as any, 'advance').mockRejectedValue(
      new VendixHttpException({
        code: 'TEST_TRANSIENT',
        httpStatus: 503,
        devMessage: 'Proveedor temporalmente no disponible',
      } as any),
    );
    jest.spyOn(service, 'getOperation').mockResolvedValue({ id: 21 } as any);
    await service.resume(21);
    expect(prisma.invoice_holder_changes.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          run_status: 'retryable_error',
          last_error_code: 'TEST_TRANSIENT',
        }),
      }),
    );
  });
  it('pending credit note is never treated as fiscal acceptance', async () => {
    const { service, prisma, ledger, flow } = harness();
    prisma.invoices.findFirst.mockResolvedValue({ id: 11, status: 'sent' });
    ledger.findAcceptedInvoiceTransmission.mockResolvedValue(null);
    await expect(
      (service as any).driveDocument(11, {
        id: 21,
        store_id: 3,
        organization_id: 7,
      }),
    ).resolves.toBe(false);
    expect(flow.send).not.toHaveBeenCalled();
  });
  it('exhausted transient retries become action_required with no phantom scheduled retry', async () => {
    const { service, prisma } = harness();
    let owner: string;
    prisma.invoice_holder_changes.updateMany.mockImplementation(
      async ({ data }: any) => {
        if (data.lease_owner) owner = data.lease_owner;
        return { count: 1 };
      },
    );
    prisma.invoice_holder_changes.findFirst.mockImplementation(async () => ({
      id: 21,
      store_id: 3,
      organization_id: 7,
      phase: 'waiting_credit_note_dian',
      run_status: 'retryable_error',
      attempt_count: 7,
      lease_owner: owner,
      lease_expires_at: new Date(Date.now() + 120000),
    }));
    jest
      .spyOn(service as any, 'advance')
      .mockRejectedValue(new Error('temporary failure'));
    jest.spyOn(service, 'getOperation').mockResolvedValue({ id: 21 } as any);
    await service.resume(21);
    expect(prisma.invoice_holder_changes.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          run_status: 'action_required',
          attempt_count: 8,
          next_retry_at: null,
        }),
      }),
    );
  });
  it('economic hash is independent of replacement line IDs, but detects tax-line reassignment and cent drift', () => {
    const invoice: any = {
      subtotal_amount: new Prisma.Decimal(100),
      tax_amount: new Prisma.Decimal(19),
      total_amount: new Prisma.Decimal(119),
      invoice_items: [
        { id: 1, description: 'a', quantity: 1, unit_price: 50 },
        { id: 2, description: 'b', quantity: 1, unit_price: 50 },
      ],
      invoice_taxes: [
        { id: 3, invoice_item_id: 1, tax_type: 'iva', tax_amount: 19 },
      ],
    };
    const copy = {
      ...invoice,
      invoice_items: invoice.invoice_items.map((i: any) => ({
        ...i,
        id: i.id + 10,
      })),
      invoice_taxes: [
        { ...invoice.invoice_taxes[0], id: 30, invoice_item_id: 11 },
      ],
    };
    expect(holderEconomicHash(copy)).toBe(holderEconomicHash(invoice));
    expect(
      holderEconomicHash({
        ...copy,
        total_amount: new Prisma.Decimal('119.01'),
      }),
    ).not.toBe(holderEconomicHash(invoice));
    expect(
      holderEconomicHash({
        ...copy,
        invoice_taxes: [{ ...copy.invoice_taxes[0], invoice_item_id: 12 }],
      }),
    ).not.toBe(holderEconomicHash(invoice));
  });
});
