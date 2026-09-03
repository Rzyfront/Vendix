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
      // `send()` resolves the tenant timezone to build IssueDate/IssueTime.
      // Returning null exercises the documented fallback to America/Bogota.
      store_settings: {
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

    // WithholdingFlowService is only reached for documents that practise
    // withholding; the flows under test do not, so a stub that reports "no
    // withholding" keeps the arity honest without inventing behaviour.
    const withholdingFlow = {
      resolvePracticed: jest.fn().mockResolvedValue({ lines: [], total: 0 }),
      // Las ventas resuelven DOS lados: lo que el cliente nos retiene
      // (`suffered`) y lo que nos autorretenemos (`self`). Sin estos dos stubs
      // la resolución revienta y el `try/catch` degrada a cero retenciones, con
      // lo que el test pasaría verde sin haber ejercido nunca ese camino.
      resolveSuffered: jest
        .fn()
        .mockResolvedValue({ lines: [], uvt_value_used: 0, counterparty_type: null }),
      resolveSelf: jest
        .fn()
        .mockResolvedValue({ lines: [], uvt_value_used: 0, counterparty_type: null }),
      persistWithholdingLines: jest.fn().mockResolvedValue(undefined),
      ...overrides.withholdingFlow,
    };

    // Las tres piezas que el flujo ganó con la reconstrucción fiscal. Se
    // declaran aprobando —no como `{}`— porque `validate()` y `send()` las
    // llaman en el camino feliz: un doble vacío haría reventar el flujo con
    // «no es una función» y el test diría «rechazó» donde el código real emite.
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
        document_type: 'factura_venta',
        computed: {},
      }),
      ...overrides.fiscalDocument,
    };
    // `reveal` devuelve `null` a propósito: estos casos no ejercen el hash del
    // CUFE, y devolver una ClTec inventada afirmaría una clave que no existe.
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
      configClient,
      provider,
      resolver,
      eventEmitter,
      fiscalLedger,
      fiscalGate,
      withholdingFlow,
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

  // Reenvío de un `rejected`: antes de este fix, `send()` sólo comprobaba que
  // la transición fuera legal (`VALID_TRANSITIONS.rejected` incluye `sent`) y
  // transmitía directo, sin volver a pasar por la puerta de prevalidación
  // fiscal que `validate()` sí exige. Un documento que la DIAN ya rechazó
  // podía reenviarse tal cual, gastando un segundo consecutivo irrecuperable
  // si el defecto seguía ahí.
  describe('reenvío de un documento rechazado', () => {
    it('revalida con la puerta fiscal (signing_date incluido) antes de transmitir', async () => {
      const rejectedInvoice = { ...supportDocument, status: 'rejected' };
      const fiscalDocumentValidate = jest.fn().mockReturnValue({
        emittable: true,
        blockers: [],
        warnings: [],
        document_type: 'support_document',
        computed: {},
      });

      const { service, provider, resolver } = createService({
        prisma: {
          invoices: {
            findFirst: jest.fn().mockResolvedValue(rejectedInvoice),
            update: jest
              .fn()
              .mockResolvedValue({ ...rejectedInvoice, status: 'accepted' }),
          },
        },
        fiscalDocument: { validate: fiscalDocumentValidate },
      });

      await RequestContextService.run(requestContext, () => service.send(100));

      // Se llamó ANTES de transmitir, y con `signing_date` poblado — el único
      // punto de la cadena donde la regla FAD09e (IssueDate == fecha de
      // firma) se juzga de verdad.
      expect(fiscalDocumentValidate).toHaveBeenCalledWith(
        expect.objectContaining({ signing_date: expect.any(Date) }),
      );
      expect(resolver.resolve).toHaveBeenCalled();
      expect(provider.sendSupportDocument).toHaveBeenCalled();
    });

    it('bloquea el reenvío sin transmitir si la revalidación sigue fallando', async () => {
      const rejectedInvoice = { ...supportDocument, status: 'rejected' };
      const fiscalDocumentValidate = jest.fn().mockReturnValue({
        emittable: false,
        blockers: [
          {
            code: 'RESOLUTION_EXPIRED',
            category: 'resolution',
            field: 'resolution',
            problem: 'La resolución vigente venció.',
            fix: 'Registra una resolución vigente antes de reenviar.',
          },
        ],
        warnings: [],
        document_type: 'support_document',
        computed: {},
      });

      const { service, provider, resolver, fiscalLedger } = createService({
        prisma: {
          invoices: {
            findFirst: jest.fn().mockResolvedValue(rejectedInvoice),
          },
        },
        fiscalDocument: { validate: fiscalDocumentValidate },
      });

      await expect(
        RequestContextService.run(requestContext, () => service.send(100)),
      ).rejects.toMatchObject({
        errorCode: 'INVOICING_PREVALIDATION_002',
      });

      // El bloqueo se cortó ANTES de reservar transmisión o llamar al
      // proveedor — el mismo principio que protege el consecutivo en
      // `validate()`: rechazar acá es recuperable, rechazar en la DIAN no.
      expect(fiscalLedger.ensureInvoiceTransmission).not.toHaveBeenCalled();
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(provider.sendSupportDocument).not.toHaveBeenCalled();
    });

    // Un `rejected` con `issue_date` de otro día viola FAD09e al revalidar el
    // reenvío. El mensaje genérico de `fiscal-document.validator.ts` manda a
    // «actualizar la fecha de emisión» — instrucción imposible aquí: un
    // `rejected` no vuelve a `draft` (`VALID_TRANSITIONS`) y `InvoicingService
    // .update()` rechaza cualquier factura fuera de `draft`. El mensaje debe
    // nombrar el camino que sí existe: anular y emitir de nuevo.
    it('si la revalidación choca con FAD09e, el mensaje manda a anular y reemitir, no a editar la fecha', async () => {
      const rejectedInvoice = { ...supportDocument, status: 'rejected' };
      const fiscalDocumentValidate = jest.fn().mockReturnValue({
        emittable: false,
        blockers: [
          {
            code: 'ISSUE_DATE_AFTER_SIGNING_DATE',
            category: 'content',
            field: 'issue_date',
            problem:
              'Documento soporte declara fecha de emisión 2026-03-10 pero se va a firmar el 2026-09-02.',
            fix: 'Actualiza la fecha de emisión del documento a 2026-09-02 en el encabezado del documento antes de transmitirlo.',
          },
        ],
        warnings: [],
        document_type: 'support_document',
        computed: {},
      });

      const { service, provider, resolver, fiscalLedger } = createService({
        prisma: {
          invoices: {
            findFirst: jest.fn().mockResolvedValue(rejectedInvoice),
          },
        },
        fiscalDocument: { validate: fiscalDocumentValidate },
      });

      await expect(
        RequestContextService.run(requestContext, () => service.send(100)),
      ).rejects.toMatchObject({
        errorCode: 'INVOICING_PREVALIDATION_004',
        message: expect.stringMatching(/anúl|anula/i),
      });

      const rejection = await RequestContextService.run(
        requestContext,
        () => service.send(100),
      ).catch((error) => error);
      // No debe sobrevivir la instrucción irrealizable del camino de `draft`.
      expect(rejection.message).not.toMatch(/actualiza la fecha de emisión/i);
      expect(fiscalLedger.ensureInvoiceTransmission).not.toHaveBeenCalled();
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(provider.sendSupportDocument).not.toHaveBeenCalled();
    });
  });
});
