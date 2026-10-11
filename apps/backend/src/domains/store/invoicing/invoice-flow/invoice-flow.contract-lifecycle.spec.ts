import { InvoiceFlowService } from './invoice-flow.service';

describe('InvoiceFlowService · contract fiscal lifecycle', () => {
  const fiscalKey = 'a'.repeat(96);
  const contract = {
    id: 33,
    contract_id: 17,
    store_id: 4,
    organization_id: 2,
    accepted_at: null,
    status: 'sent',
    cufe: null,
  };

  function activeContractDb(order: string[], accepted = acceptedInvoice()) {
    return {
      contracts: {
        findFirst: jest.fn(async () => {
          order.push('contract-read');
          return { status: 'active', updated_at: new Date('2026-10-10T11:00:00Z') };
        }),
        updateMany: jest.fn(async () => {
          order.push('contract-update');
          return { count: 1 };
        }),
      },
      invoices: {
        updateMany: jest.fn(async () => {
          order.push('invoice-update');
          return { count: 1 };
        }),
        findFirst: jest.fn(async () => accepted),
      },
    };
  }

  function transactionalPrisma(order: string[], accepted = acceptedInvoice()) {
    const tx = activeContractDb(order, accepted);
    return {
      contracts: tx.contracts,
      transactionClient: tx,
      withoutScope: jest.fn(() => ({
        $transaction: jest.fn(async (callback: (client: any) => unknown) =>
          callback(tx),
        ),
      })),
    };
  }

  function acceptedInvoice() {
    return {
      ...contract,
      status: 'accepted',
      accepted_at: new Date('2026-10-10T12:00:00Z'),
      cufe: fiscalKey,
      invoice_type: 'invoice',
      invoice_number: 'FV-100',
      accounting_entity_id: 9,
      financial_account_id: null,
      subtotal_amount: 100,
      discount_amount: 0,
      tax_amount: 19,
      shipping_amount: 0,
      withholding_amount: 0,
      total_amount: 119,
      invoice_taxes: [],
      customer: null,
      supplier_id: null,
    };
  }

  it('persiste factura y contrato antes de los efectos posteriores en aceptación DIAN', async () => {
    const order: string[] = [];
    const updated = acceptedInvoice();
    const svc = Object.create(InvoiceFlowService.prototype) as any;
    svc.prisma = transactionalPrisma(order, updated);
    svc.fiscal_ledger = {
      markAccepted: jest.fn(async () => order.push('ledger-accepted')),
    };
    svc.isSupportDocumentType = jest.fn(() => false);
    svc.persistWithholdingBatches = jest.fn(async () => {
      order.push('withholding');
      return [];
    });
    svc.event_emitter = {
      emit: jest.fn(async () => order.push('event')),
      emitAsync: jest.fn(async () => order.push('event-async')),
    };
    svc.getContext = jest.fn(() => ({ user_id: 5 }));
    svc.logger = { log: jest.fn() };

    await svc.applyDianAcceptance({
      id: 33,
      invoice: contract,
      transmission_id: 8,
      provider_response: { cufe: fiscalKey, tracking_id: 'trk-8' },
      provider_data: {},
      acquirer_identity: {},
      is_support_document: false,
      withholding_batches: [],
    });

    expect(order).toEqual([
      'ledger-accepted',
      'invoice-update',
      'contract-read',
      'contract-update',
      'withholding',
      'event',
    ]);
  });

  it('marca el contrato antes de persistir la factura con ledger aceptado', async () => {
    const order: string[] = [];
    const invoice = { ...contract };
    const svc = Object.create(InvoiceFlowService.prototype) as any;
    svc.prisma = transactionalPrisma(order);
    svc.getInvoice = jest.fn(async () => invoice);
    svc.assertInvoicingAreaActive = jest.fn();
    svc.assertFiscalPeriodOpen = jest.fn();
    svc.fiscal_ledger = {
      findAcceptedInvoiceTransmission: jest.fn(async () => ({
        id: 12,
        tracking_id: 'trk-12',
        cufe: fiscalKey,
      })),
    };
    svc.isSupportDocumentType = jest.fn(() => false);
    svc.resolveWithholdingForInvoice = jest.fn(async () => {
      order.push('withholding');
      return [];
    });
    svc.event_emitter = {
      emit: jest.fn(async () => order.push('event')),
      emitAsync: jest.fn(async () => order.push('event-async')),
    };
    svc.getContext = jest.fn(() => ({ user_id: 5 }));
    svc.logger = { log: jest.fn() };

    await svc.accept(33);

    expect(order).toEqual([
      'invoice-update',
      'contract-read',
      'contract-update',
      'withholding',
      'event',
    ]);
    expect(svc.prisma.transactionClient.invoices.updateMany).toHaveBeenCalledWith({
      where: {
        id: 33,
        store_id: 4,
        organization_id: 2,
        status: 'sent',
      },
      data: expect.objectContaining({ status: 'accepted', cufe: fiscalKey }),
    });
  });

  it('un retry de una factura ya aceptada repara sólo el contrato', async () => {
    const order: string[] = [];
    const invoice = acceptedInvoice();
    const svc = Object.create(InvoiceFlowService.prototype) as any;
    svc.prisma = activeContractDb(order);
    svc.getInvoice = jest.fn(async () => invoice);
    svc.assertInvoicingAreaActive = jest.fn();
    svc.fiscal_ledger = { findAcceptedInvoiceTransmission: jest.fn() };
    svc.event_emitter = { emit: jest.fn(), emitAsync: jest.fn() };

    await expect(svc.accept(33)).resolves.toBe(invoice);

    expect(order).toEqual(['contract-read', 'contract-update']);
    expect(svc.assertInvoicingAreaActive).not.toHaveBeenCalled();
    expect(svc.fiscal_ledger.findAcceptedInvoiceTransmission).not.toHaveBeenCalled();
    expect(svc.event_emitter.emit).not.toHaveBeenCalled();
  });

  it('mantiene el update scoped original para facturas sin contrato', async () => {
    const updated = { id: 34, status: 'accepted' };
    const invoices = { update: jest.fn().mockResolvedValue(updated) };
    const svc = Object.create(InvoiceFlowService.prototype) as any;
    svc.prisma = { invoices };

    await expect(
      svc.persistAcceptedInvoiceAndContract(
        { id: 34, contract_id: null },
        { status: 'accepted' },
      ),
    ).resolves.toBe(updated);

    expect(invoices.update).toHaveBeenCalledWith({
      where: { id: 34 },
      data: { status: 'accepted' },
      include: expect.any(Object),
    });
    expect(svc.prisma.withoutScope).toBeUndefined();
  });
});
