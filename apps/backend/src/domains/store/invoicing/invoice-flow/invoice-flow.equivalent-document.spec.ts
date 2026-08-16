import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { InvoiceFlowService } from './invoice-flow.service';

/**
 * The POS equivalent document (Res. 000165/2023) is a DIFFERENT fiscal document
 * from the factura electrónica de venta, and the three ways they must not be
 * confused all live in this service:
 *
 * 1. It resolves the `equivalent_document` habilitación, not `invoicing` — the
 *    DIAN authorizes the software per document type, with its own set de pruebas.
 * 2. It calls `sendEquivalentDocument`, so the CUDE path (Software-PIN) is used
 *    instead of the CUFE path (ClTec).
 * 3. A provider that cannot emit it must be refused BEFORE the transmission row
 *    exists, because the consecutive it would consume comes from an authorized
 *    range the DIAN never lets us reuse.
 */
describe('InvoiceFlowService POS equivalent document', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const posTicket = {
    id: 400,
    organization_id: 1,
    store_id: 2,
    accounting_entity_id: 77,
    invoice_number: 'POS400',
    invoice_type: 'pos_equivalent_document',
    status: 'validated',
    supplier_id: null,
    supplier: null,
    customer_name: 'Consumidor final',
    customer_tax_id: '222222222222',
    customer_address: null,
    subtotal_amount: { toString: () => '1000.00' },
    discount_amount: { toString: () => '0.00' },
    tax_amount: { toString: () => '190.00' },
    withholding_amount: { toString: () => '0.00' },
    total_amount: { toString: () => '1190.00' },
    currency: 'COP',
    issue_date: new Date('2026-08-04T15:00:00.000Z'),
    due_date: new Date('2026-08-04T15:00:00.000Z'),
    invoice_items: [
      {
        description: 'Producto',
        quantity: { toString: () => '1' },
        unit_price: { toString: () => '1000.00' },
        discount_amount: { toString: () => '0.00' },
        tax_amount: { toString: () => '190.00' },
        total_amount: { toString: () => '1000.00' },
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
    // The DE range carries NO technical_key: the ClTec belongs to a FEV range and
    // the DE key is built with the Software-PIN instead.
    // Resolución COMPLETA: el bloque sts:InvoiceControl se construye desde esta
    // fila, así que un fixture con solo el número describe una resolución que no
    // puede respaldar una emisión — y antes pasaba porque nadie lo comprobaba.
    // `technical_key` sigue en null a propósito: la clave técnica solo es
    // obligatoria para la factura electrónica de venta, no para el DE POS.
    resolution: {
      id: 42,
      resolution_number: '18760000900',
      technical_key: null,
      prefix: 'DE',
      range_from: 1,
      range_to: 5000,
      valid_from: new Date('2026-01-01T05:00:00.000Z'),
      valid_to: new Date('2030-01-01T05:00:00.000Z'),
      is_active: true,
      document_type: 'pos_equivalent_document',
    },
    related_invoice: null,
    notes: null,
  };

  const createService = (overrides: any = {}) => {
    const acceptedTicket = {
      ...posTicket,
      status: 'accepted',
      send_status: 'sent_ok',
      transmission_status: 'accepted',
      dian_status: 'accepted',
      accounting_status: 'provisional',
      cude: 'mock-cude',
    };
    const configClient = {
      dian_configurations: {
        findFirst: jest.fn().mockResolvedValue({ id: 950 }),
      },
    };
    const prisma = {
      invoices: {
        findFirst: jest.fn().mockResolvedValue(posTicket),
        update: jest.fn().mockResolvedValue(acceptedTicket),
      },
      accounts_payable: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      fiscal_close_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      withoutScope: () => configClient,
      ...overrides.prisma,
    };
    const provider = {
      sendInvoice: jest.fn(),
      sendCreditNote: jest.fn(),
      sendEquivalentDocument: jest.fn().mockResolvedValue({
        success: true,
        tracking_id: 'track-de',
        cude: 'mock-cude',
        qr_code: 'qr',
        xml_document: '<xml/>',
        provider_data: { mock: true },
      }),
      sendEquivalentAdjustmentNote: jest.fn().mockResolvedValue({
        success: true,
        tracking_id: 'track-de-aj',
        cude: 'mock-cude-aj',
        qr_code: 'qr',
        xml_document: '<xml/>',
        provider_data: { mock: true },
      }),
      ...overrides.provider,
    };
    const resolver = {
      resolve: jest.fn().mockResolvedValue(provider),
      ...overrides.resolver,
    };
    const eventEmitter = {
      emit: jest.fn(),
      ...overrides.eventEmitter,
    } as unknown as EventEmitter2;
    const retryQueue = { enqueue: jest.fn(), ...overrides.retryQueue };
    const fiscalLedger = {
      ensureInvoiceTransmission: jest.fn().mockResolvedValue({ id: 850 }),
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
    const withholdingFlow = {
      resolvePracticed: jest.fn().mockResolvedValue({ lines: [], total: 0 }),
      // El documento equivalente es una VENTA: resuelve `suffered` + `self`, no
      // `practiced`. Sin estos dos stubs la resolución lanza y el `try/catch`
      // la degrada a cero, tapando cualquier regresión en ese camino.
      resolveSuffered: jest
        .fn()
        .mockResolvedValue({ lines: [], uvt_value_used: 0, counterparty_type: null }),
      resolveSelf: jest
        .fn()
        .mockResolvedValue({ lines: [], uvt_value_used: 0, counterparty_type: null }),
      persistWithholdingLines: jest.fn().mockResolvedValue(undefined),
      ...overrides.withholdingFlow,
    };

    // Validador de identidad, prevalidador fiscal y bóveda de la ClTec: los
    // tres se llaman en el camino feliz de `validate()`/`send()`, así que se
    // declaran aprobando en vez de `{}` — un doble vacío rompería el flujo con
    // «no es una función» y el caso mediría el error equivocado.
    const acquirerIdentity = {
      validate: jest
        .fn()
        .mockReturnValue({ emittable: true, blockers: [], warnings: [] }),
      ...overrides.acquirerIdentity,
    };
    const fiscalDocument = {
      validate: jest.fn().mockReturnValue({
        emittable: true,
        blockers: [],
        warnings: [],
        document_type: 'documento_equivalente_pos',
        computed: {},
      }),
      ...overrides.fiscalDocument,
    };
    const technicalKeyVault = {
      reveal: jest.fn().mockReturnValue(null),
      sealForWrite: jest.fn().mockReturnValue({
        technical_key: null,
        technical_key_encrypted: null,
        technical_key_fingerprint: null,
      }),
      ...overrides.technicalKeyVault,
    };

    return {
      service: new InvoiceFlowService(
        prisma as any,
        resolver as any,
        eventEmitter,
        retryQueue as any,
        fiscalLedger as any,
        fiscalGate as any,
        withholdingFlow as any,
        acquirerIdentity as any,
        fiscalDocument as any,
        technicalKeyVault as any,
      ),
      prisma,
      provider,
      resolver,
      fiscalLedger,
    };
  };

  it('resolves the equivalent_document habilitación, never invoicing', async () => {
    const { service, resolver } = createService();

    await RequestContextService.run(requestContext, () => service.send(400));

    expect(resolver.resolve).toHaveBeenCalledWith({
      configuration_type: 'equivalent_document',
    });
  });

  it('transmits through sendEquivalentDocument and not sendInvoice', async () => {
    const { service, provider } = createService();

    await RequestContextService.run(requestContext, () => service.send(400));

    expect(provider.sendEquivalentDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_number: 'POS400',
        invoice_type: 'pos_equivalent_document',
      }),
    );
    expect(provider.sendInvoice).not.toHaveBeenCalled();
  });

  /**
   * `invoices.cufe` is the schema's single document-key column, so the CUDE lands
   * there exactly as the support document's CUDS already does. The TYPED key is
   * kept by `fiscal_transmissions` (`markAccepted`), which is where an auditor
   * reads which algorithm produced it. Asserting both sides pins the split, so a
   * future refactor cannot start writing a CUDE into a column an FEV consumer
   * reads as a CUFE without breaking a test.
   */
  it('persists the CUDE in the document-key column and typed in the ledger', async () => {
    const { service, prisma, fiscalLedger } = createService();

    await RequestContextService.run(requestContext, () => service.send(400));

    expect(prisma.invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cufe: 'mock-cude',
          fiscal_document_type: 'pos_equivalent_document',
        }),
      }),
    );
    expect(fiscalLedger.markAccepted).toHaveBeenCalledWith(
      850,
      expect.objectContaining({ cude: 'mock-cude' }),
    );
  });

  it('routes the adjustment note to sendEquivalentAdjustmentNote', async () => {
    const { service, provider } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            ...posTicket,
            invoice_type: 'equivalent_adjustment_note',
          }),
          update: jest.fn().mockResolvedValue({
            ...posTicket,
            invoice_type: 'equivalent_adjustment_note',
            status: 'accepted',
          }),
        },
      },
    });

    await RequestContextService.run(requestContext, () => service.send(400));

    expect(provider.sendEquivalentAdjustmentNote).toHaveBeenCalledTimes(1);
    expect(provider.sendEquivalentDocument).not.toHaveBeenCalled();
  });

  /**
   * The load-bearing assertion of this file: the refusal must happen before
   * `ensureInvoiceTransmission`, because that is the call that commits the
   * document to a consecutive of the DE range.
   */
  it('refuses before spending a consecutive when the provider cannot emit a DE', async () => {
    const { service, fiscalLedger } = createService({
      provider: { sendEquivalentDocument: undefined },
    });

    await expect(
      RequestContextService.run(requestContext, () => service.send(400)),
    ).rejects.toMatchObject({ errorCode: 'FISCAL_DOCUMENT_UNSUPPORTED' });

    expect(fiscalLedger.ensureInvoiceTransmission).not.toHaveBeenCalled();
    expect(fiscalLedger.markSubmitted).not.toHaveBeenCalled();
  });

  it('refuses an adjustment note the provider cannot emit', async () => {
    const { service, fiscalLedger } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            ...posTicket,
            invoice_type: 'equivalent_adjustment_note',
          }),
          update: jest.fn(),
        },
      },
      provider: { sendEquivalentAdjustmentNote: undefined },
    });

    await expect(
      RequestContextService.run(requestContext, () => service.send(400)),
    ).rejects.toMatchObject({ errorCode: 'FISCAL_DOCUMENT_UNSUPPORTED' });

    expect(fiscalLedger.ensureInvoiceTransmission).not.toHaveBeenCalled();
  });
});
