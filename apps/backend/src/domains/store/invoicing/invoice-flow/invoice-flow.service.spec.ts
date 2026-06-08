import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { InvoiceFlowService } from './invoice-flow.service';

describe('InvoiceFlowService support documents', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const supportDocument = {
    id: 100,
    organization_id: 1,
    store_id: 2,
    accounting_entity_id: 77,
    invoice_number: 'DS100',
    invoice_type: 'support_document',
    status: 'validated',
    supplier_id: 50,
    supplier: {
      id: 50,
      name: 'Proveedor No Obligado',
      tax_id: '123456789',
      document_type: 'CC',
      tax_regime: 'no_responsable_iva',
    },
    customer_name: null,
    customer_tax_id: null,
    customer_address: null,
    subtotal_amount: { toString: () => '1000.00' },
    discount_amount: { toString: () => '0.00' },
    tax_amount: { toString: () => '190.00' },
    withholding_amount: { toString: () => '120.00' },
    total_amount: { toString: () => '1190.00' },
    currency: 'COP',
    issue_date: new Date('2026-03-10T10:00:00.000Z'),
    due_date: new Date('2026-03-20T00:00:00.000Z'),
    invoice_items: [
      {
        description: 'Servicio profesional',
        quantity: { toString: () => '1' },
        unit_price: { toString: () => '1000.00' },
        discount_amount: { toString: () => '0.00' },
        tax_amount: { toString: () => '190.00' },
        total_amount: { toString: () => '1190.00' },
      },
    ],
    invoice_taxes: [
      {
        tax_name: 'IVA',
        tax_rate: { toString: () => '19' },
        taxable_amount: { toString: () => '1000.00' },
        tax_amount: { toString: () => '190.00' },
      },
    ],
    resolution: { resolution_number: '18760000001', technical_key: 'abc' },
    related_invoice: null,
    notes: 'Documento soporte compra a no obligado',
  };

  const createService = (overrides: any = {}) => {
    const acceptedInvoice = {
      ...supportDocument,
      status: 'accepted',
      send_status: 'sent_ok',
      transmission_status: 'accepted',
      dian_status: 'accepted',
      accounting_status: 'provisional',
      cufe: 'mock-cuds',
    };
    const configClient = {
      dian_configurations: {
        findFirst: jest.fn().mockResolvedValue({ id: 900 }),
      },
    };
    const prisma = {
      invoices: {
        findFirst: jest.fn().mockResolvedValue(supportDocument),
        update: jest.fn().mockResolvedValue(acceptedInvoice),
      },
      accounts_payable: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 700 }),
        update: jest.fn(),
      },
      fiscal_close_sessions: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      withoutScope: () => configClient,
      ...overrides.prisma,
    };
    const provider = {
      sendSupportDocument: jest.fn().mockResolvedValue({
        success: true,
        tracking_id: 'track-1',
        cuds: 'mock-cuds',
        qr_code: 'qr',
        xml_document: '<xml/>',
        provider_data: { mock: true },
      }),
      sendInvoice: jest.fn(),
      sendCreditNote: jest.fn(),
    };
    const resolver = {
      resolve: jest.fn().mockResolvedValue(provider),
      ...overrides.resolver,
    };
    const eventEmitter = {
      emit: jest.fn(),
      ...overrides.eventEmitter,
    } as unknown as EventEmitter2;
    const retryQueue = {
      enqueue: jest.fn(),
      ...overrides.retryQueue,
    };
    const fiscalLedger = {
      ensureInvoiceTransmission: jest.fn().mockResolvedValue({ id: 800 }),
      markSubmitted: jest.fn().mockResolvedValue(undefined),
      markAccepted: jest.fn().mockResolvedValue(undefined),
      markRejected: jest.fn(),
      markError: jest.fn(),
      findAcceptedInvoiceTransmission: jest.fn(),
      ...overrides.fiscalLedger,
    };
    const fiscalGate = {
      isAreaEnabled: jest.fn().mockResolvedValue(true),
      isSubflowEnabled: jest.fn().mockResolvedValue(true),
      ...overrides.fiscalGate,
    };

    return {
      service: new InvoiceFlowService(
        prisma as any,
        resolver as any,
        eventEmitter,
        retryQueue as any,
        fiscalLedger as any,
        fiscalGate as any,
      ),
      prisma,
      configClient,
      provider,
      resolver,
      eventEmitter,
      fiscalLedger,
      fiscalGate,
    };
  };

  it('sends support documents through support_document provider flow and creates CxP', async () => {
    const { service, prisma, provider, resolver, eventEmitter, fiscalLedger } =
      createService();

    await RequestContextService.run(requestContext, () => service.send(100));

    expect(resolver.resolve).toHaveBeenCalledWith({
      configuration_type: 'support_document',
    });
    expect(fiscalLedger.ensureInvoiceTransmission).toHaveBeenCalledWith({
      invoice: expect.objectContaining({
        id: 100,
        invoice_type: 'support_document',
      }),
      provider_data: expect.objectContaining({
        invoice_number: 'DS100',
        customer_name: 'Proveedor No Obligado',
        customer_tax_id: '123456789',
        customer_document_type: 'CC',
      }),
      dian_configuration_id: 900,
      user_id: 9,
    });
    expect(provider.sendSupportDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_number: 'DS100',
        invoice_type: 'support_document',
      }),
    );
    expect(prisma.accounts_payable.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organization_id: 1,
        store_id: 2,
        supplier_id: 50,
        source_type: 'support_document',
        source_id: 100,
        document_number: 'DS100',
        original_amount: 1070,
        balance: 1070,
      }),
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'support_document.accepted',
      expect.objectContaining({
        invoice_id: 100,
        invoice_type: 'support_document',
        accounting_entity_id: 77,
        supplier_id: 50,
        withholding_amount: 120,
      }),
    );
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      'invoice.accepted',
      expect.anything(),
    );
  });

  it('rejects support document send when supplier has no tax id', async () => {
    const { service, provider, fiscalLedger } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            ...supportDocument,
            supplier: { ...supportDocument.supplier, tax_id: null },
            customer_tax_id: null,
          }),
        },
      },
    });

    await expect(
      RequestContextService.run(requestContext, () => service.send(100)),
    ).rejects.toMatchObject({
      errorCode: 'FISCAL_CONFIG_INCOMPLETE',
    });
    expect(provider.sendSupportDocument).not.toHaveBeenCalled();
    expect(fiscalLedger.ensureInvoiceTransmission).not.toHaveBeenCalled();
  });

  it('blocks provider submission when the fiscal period is closed', async () => {
    const { service, provider, fiscalLedger } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue(supportDocument),
          update: jest.fn(),
        },
        fiscal_close_sessions: {
          findFirst: jest.fn().mockResolvedValue({
            id: 300,
            period_year: 2026,
            period_month: 3,
            closed_at: new Date('2026-04-05T00:00:00.000Z'),
          }),
        },
      },
    });

    await expect(
      RequestContextService.run(requestContext, () => service.send(100)),
    ).rejects.toMatchObject({
      errorCode: 'FISCAL_ACCOUNTING_BLOCKED',
    });
    expect(provider.sendSupportDocument).not.toHaveBeenCalled();
    expect(fiscalLedger.ensureInvoiceTransmission).not.toHaveBeenCalled();
  });
});
