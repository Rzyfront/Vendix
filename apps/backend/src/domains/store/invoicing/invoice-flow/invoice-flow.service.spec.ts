import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { InvoiceFlowService } from './invoice-flow.service';
import { CustomerFiscalIdentityValidator } from '../validators/customer-fiscal-identity.validator';

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

  /**
   * Rechazo RECIENTE. Los tres specs de reenvío juzgan la puerta fiscal, no el
   * plazo: si heredaran la `issue_date` de marzo de `supportDocument` los
   * cortaría antes `assertResendWindowOpen` y pasarían —o fallarían— por un
   * motivo que no es el que anuncian. El plazo tiene sus propios specs abajo.
   */
  const recentRejected = (hours_ago = 2) => {
    const instant = new Date(Date.now() - hours_ago * 60 * 60 * 1000);
    return {
      ...supportDocument,
      status: 'rejected',
      issue_date: instant,
      created_at: instant,
    };
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
      checkStatus: jest.fn(),
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
      claimSubmission: jest.fn().mockResolvedValue(undefined),
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
      // `resolveWithholdingBatches` agrupa por bien/servicio y llama a este
      // método en vez de `resolveSuffered` directo (Step 1 del plan
      // pago-multimetodo-pendientes). Sin este stub la resolución revienta y
      // el `try/catch` degrada a cero, tapando cualquier regresión ahí.
      resolveSufferedByOperation: jest
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

    // A.1 CP-facturacion-fixes: numbering point moved to validate(). Numberless
    // drafts get FV-numbers here; already-numbered documents must not consume.
    const numberGenerator = {
      generateNextNumber: jest.fn().mockResolvedValue({
        invoice_number: 'FV-NEW-1',
        resolution_id: 7001,
      }),
      ...overrides.numberGenerator,
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
        numberGenerator as any,
      ),
      prisma,
      configClient,
      provider,
      resolver,
      eventEmitter,
      fiscalLedger,
      fiscalGate,
      withholdingFlow,
      numberGenerator,
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

  describe('reserva atómica y resolución por GetStatus', () => {
    const rule90 = {
      code: '90',
      text: 'Regla 90: Documento procesado anteriormente',
      severity: 'rechazo',
    };

    it('dos send() concurrentes: el proveedor se llama 1 vez y el segundo recibe FISCAL_SEND_IN_PROGRESS', async () => {
      const { VendixHttpException, ErrorCodes } = await import(
        'src/common/errors'
      );
      let claimed = false;
      const claimSubmission = jest.fn().mockImplementation(async () => {
        if (claimed) {
          throw new VendixHttpException(ErrorCodes.FISCAL_SEND_IN_PROGRESS);
        }
        claimed = true;
      });
      const { service, provider, fiscalLedger } = createService({
        fiscalLedger: { claimSubmission },
      });

      const results = await Promise.allSettled([
        RequestContextService.run(requestContext, () => service.send(100)),
        RequestContextService.run(requestContext, () => service.send(100)),
      ]);

      expect(provider.sendSupportDocument).toHaveBeenCalledTimes(1);
      const rejected = results.filter((r) => r.status === 'rejected') as any[];
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.errorCode).toBe('FISCAL_SEND_IN_PROGRESS');
      // Sin markError ni contingencia para el llamador que perdio la reserva.
      expect(fiscalLedger.markError).not.toHaveBeenCalled();
    });

    it('Regla 90 + GetStatus accepted: acepta la factura y emite el evento de aceptación', async () => {
      const { service, provider, prisma, eventEmitter, fiscalLedger } =
        createService();
      provider.sendSupportDocument.mockResolvedValue({
        success: false,
        tracking_id: 'track-1',
        cuds: 'cuds-1',
        message: 'rechazado',
        provider_data: {
          already_processed: true,
          timed_out: false,
          rule_messages: [rule90],
        },
      });
      provider.checkStatus.mockResolvedValue({
        tracking_id: 'track-1',
        status: 'accepted',
        cufe: undefined,
        message: 'ok',
        provider_data: { application_response_xml: '<ar/>' },
      });

      await RequestContextService.run(requestContext, () => service.send(100));

      expect(provider.checkStatus).toHaveBeenCalledWith('cuds-1');
      expect(fiscalLedger.markRejected).not.toHaveBeenCalled();
      expect(fiscalLedger.markAccepted).toHaveBeenCalledTimes(1);
      const accepted = prisma.invoices.update.mock.calls
        .map(([args]: any[]) => args)
        .find((args: any) => args.data?.status === 'accepted');
      expect(accepted).toBeDefined();
      expect(accepted.data.provider_response.provider_data.resolved_via).toBe(
        'get_status_regla_90',
      );
      expect(accepted.data.provider_response.message).toContain(
        'confirmado válido vía GetStatus',
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'support_document.accepted',
        expect.objectContaining({ invoice_id: 100 }),
      );
    });

    it('Regla 90 + GetStatus rejected: sigue el camino de rechazo con la Regla 90 en el mensaje', async () => {
      const { service, provider, fiscalLedger, prisma } = createService();
      provider.sendSupportDocument.mockResolvedValue({
        success: false,
        tracking_id: 'track-1',
        cuds: 'cuds-1',
        provider_data: { already_processed: true, rule_messages: [rule90] },
      });
      provider.checkStatus.mockResolvedValue({ tracking_id: 'track-1', status: 'rejected' });

      await expect(
        RequestContextService.run(requestContext, () => service.send(100)),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_PROVIDER_004' });

      expect(fiscalLedger.markRejected).toHaveBeenCalledTimes(1);
      expect(fiscalLedger.markAccepted).not.toHaveBeenCalled();
      const rejectedUpdate = prisma.invoices.update.mock.calls
        .map(([args]: any[]) => args)
        .find((args: any) => args.data?.status === 'rejected');
      expect(rejectedUpdate.data.provider_response.errors).toEqual([
        { code: '90', text: rule90.text },
      ]);
    });

    it('timeout + GetStatus no accepted: sin contingencia 04, error reintentable', async () => {
      const declareContingency = jest.fn();
      const enqueue = jest.fn().mockResolvedValue(undefined);
      const { service, provider, fiscalLedger, prisma } = createService({
        retryQueue: { declareContingency, enqueue },
      });
      provider.sendSupportDocument.mockResolvedValue({
        success: false,
        tracking_id: '',
        cuds: 'cuds-1',
        message: 'timeout',
        contingency_eligible: true,
        failure_class: 'timeout',
        provider_data: { timed_out: true },
      });
      provider.checkStatus.mockResolvedValue({ tracking_id: 't', status: 'pending' });

      await expect(
        RequestContextService.run(requestContext, () => service.send(100)),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_PROVIDER_001' });

      expect(provider.checkStatus).toHaveBeenCalledWith('cuds-1');
      expect(declareContingency).not.toHaveBeenCalled();
      expect(fiscalLedger.markError).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledTimes(1);
      const updates = prisma.invoices.update.mock.calls.map(
        ([args]: any[]) => args.data,
      );
      expect(
        updates.some(
          (d: any) =>
            d.contingency_type === '04' ||
            d.transmission_status === 'contingency',
        ),
      ).toBe(false);
    });
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
    it('revalida con la puerta fiscal antes de transmitir, sin imponerle una fecha de firma inventada', async () => {
      const rejectedInvoice = recentRejected();
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

      // Se llamó ANTES de transmitir, y SIN `signing_date`. Antes se le pasaba
      // `new Date()` para juzgar FAD09e (IssueDate == fecha de firma), pero el
      // firmante ya no usa el reloj de pared: estampa el instante del propio
      // documento, así que las dos fechas coinciden por construcción.
      // Imponerle «ahora» bloquearía un reenvío que la DIAN sí acepta — que es
      // exactamente lo que dejó varadas a FVJL11 y FVJL12.
      expect(fiscalDocumentValidate).toHaveBeenCalled();
      expect(
        fiscalDocumentValidate.mock.calls[0][0].signing_date,
      ).toBeUndefined();
      expect(resolver.resolve).toHaveBeenCalled();
      expect(provider.sendSupportDocument).toHaveBeenCalled();
    });

    it('bloquea el reenvío sin transmitir si la revalidación sigue fallando', async () => {
      const rejectedInvoice = recentRejected();
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
      const rejectedInvoice = recentRejected();
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

    /**
     * PLAZO DE REENVÍO. Con el firmante tomando la fecha del propio documento,
     * `FAD09e` ya no puede fallar: emitir con fecha vieja pasa a ser un riesgo
     * de OTRA regla —llegar fuera de término—, y el rechazo cuesta el
     * consecutivo por segunda vez. Por eso la comparación de fechas se
     * reemplazó por un plazo.
     */
    describe('plazo de transmisión', () => {
      const passingValidation = () =>
        jest.fn().mockReturnValue({
          emittable: true,
          blockers: [],
          warnings: [],
          document_type: 'support_document',
          computed: {},
        });

      it('deja pasar el rechazo de anoche — el caso exacto de FVJL11 (26 h)', async () => {
        const { service, provider } = createService({
          prisma: {
            invoices: {
              findFirst: jest.fn().mockResolvedValue(recentRejected(26)),
              update: jest.fn().mockResolvedValue({
                ...recentRejected(26),
                status: 'accepted',
              }),
            },
          },
          fiscalDocument: { validate: passingValidation() },
        });

        await RequestContextService.run(requestContext, () =>
          service.send(100),
        );

        expect(provider.sendSupportDocument).toHaveBeenCalled();
      });

      it('corta el que ya pasó de 48 h, y lo corta ANTES de gastar nada', async () => {
        const fiscalDocumentValidate = passingValidation();
        const { service, provider, resolver, fiscalLedger } = createService({
          prisma: {
            invoices: {
              findFirst: jest.fn().mockResolvedValue(recentRejected(49)),
            },
          },
          fiscalDocument: { validate: fiscalDocumentValidate },
        });

        await expect(
          RequestContextService.run(requestContext, () => service.send(100)),
        ).rejects.toMatchObject({
          errorCode: 'INVOICING_PREVALIDATION_004',
          message: expect.stringMatching(/fuera de término|48/i),
        });

        // Se corta antes que la prevalidación fiscal, el consecutivo y el
        // proveedor: rechazar acá es recuperable, en la DIAN no.
        expect(fiscalDocumentValidate).not.toHaveBeenCalled();
        expect(fiscalLedger.ensureInvoiceTransmission).not.toHaveBeenCalled();
        expect(resolver.resolve).not.toHaveBeenCalled();
        expect(provider.sendSupportDocument).not.toHaveBeenCalled();
      });

      it('el mensaje nombra el camino que sí existe: anular y reemitir', async () => {
        const { service } = createService({
          prisma: {
            invoices: {
              findFirst: jest.fn().mockResolvedValue(recentRejected(72)),
            },
          },
          fiscalDocument: { validate: passingValidation() },
        });

        const error = await RequestContextService.run(requestContext, () =>
          service.send(100),
        ).catch((e) => e);

        expect(error.message).toMatch(/anúlalo y emite uno nuevo/i);
        // `VendixHttpException` guarda el contexto en el cuerpo de la respuesta,
        // no en una propiedad suelta.
        const body = error.getResponse();
        expect(body.details.window_hours).toBe(48);
        expect(body.details.elapsed_hours).toBeGreaterThanOrEqual(72);
        expect(body.details.invoice_number).toBe('DS100');
      });

      it('el borde: 47 h pasa y 49 h no', async () => {
        const build = (hours: number) =>
          createService({
            prisma: {
              invoices: {
                findFirst: jest.fn().mockResolvedValue(recentRejected(hours)),
                update: jest.fn().mockResolvedValue({
                  ...recentRejected(hours),
                  status: 'accepted',
                }),
              },
            },
            fiscalDocument: { validate: passingValidation() },
          });

        const dentro = build(47);
        await RequestContextService.run(requestContext, () =>
          dentro.service.send(100),
        );
        expect(dentro.provider.sendSupportDocument).toHaveBeenCalled();

        const fuera = build(49);
        await expect(
          RequestContextService.run(requestContext, () =>
            fuera.service.send(100),
          ),
        ).rejects.toMatchObject({ errorCode: 'INVOICING_PREVALIDATION_004' });
        expect(fuera.provider.sendSupportDocument).not.toHaveBeenCalled();
      });
    });
  });

  describe('deferred numbering at validate (A.1 CP-facturacion-fixes)', () => {
    const numberlessDraft = {
      ...supportDocument,
      invoice_type: 'sales_invoice',
      invoice_number: null,
      resolution_id: null,
      status: 'draft',
    };

    it('assigns a consecutive to a numberless draft during validate', async () => {
      const update = jest.fn().mockImplementation(async ({ data }: any) => ({
        ...numberlessDraft,
        ...data,
        status: data?.status ?? numberlessDraft.status,
      }));
      const { service, prisma, numberGenerator } = createService({
        prisma: {
          invoices: {
            findFirst: jest.fn().mockResolvedValue(numberlessDraft),
            update,
          },
        },
      });

      await RequestContextService.run(requestContext, () =>
        service.validate(100),
      );

      expect(numberGenerator.generateNextNumber).toHaveBeenCalledWith({
        document_type: 'sales_invoice',
        accounting_entity_id: 77,
      });
      expect(prisma.invoices.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: { invoice_number: 'FV-NEW-1', resolution_id: 7001 },
        include: expect.anything(),
      });
    });

    it('keeps the existing number and consumes nothing when already numbered', async () => {
      const numbered = { ...numberlessDraft, invoice_number: 'FV-55' };
      const { service, numberGenerator } = createService({
        prisma: {
          invoices: {
            findFirst: jest.fn().mockResolvedValue(numbered),
            update: jest.fn().mockImplementation(async ({ data }: any) => ({
              ...numbered,
              ...data,
            })),
          },
        },
      });

      await RequestContextService.run(requestContext, () =>
        service.validate(100),
      );

      expect(numberGenerator.generateNextNumber).not.toHaveBeenCalled();
    });
  });

  // Incidente Óptica Panorama SAS (NIT 800214345-7) / Pollo Árabe: una factura
  // MANUAL (`customer_id` NULL) cuyo snapshot trae NIT/31 + DV 7 + correo salió
  // transmitida a la DIAN como Cédula + persona natural, sin DV ni correo.
  // `resolveAcquirerIdentity` (`utils/acquirer-identity.resolver.ts`) es ahora la
  // fuente ÚNICA que alimenta TANTO `buildAcquirerIdentityInput` (la puerta de
  // `validate()`, vía `CustomerFiscalIdentityValidator` REAL — sin mockear en
  // este bloque, a propósito) COMO la construcción de `provider_data` dentro de
  // `send()`. Este describe ejercita los DOS puntos de entrada reales sobre la
  // MISMA factura — no llama a `resolveAcquirerIdentity` dos veces por su
  // cuenta, que sería la prueba tautológica que ya se documentó como
  // antipatrón — y comprueba que lo que el validador real aprueba es
  // exactamente lo que la emisión transmite.
  describe('Paridad real — incidente Óptica Panorama SAS: validate() real y send() coinciden', () => {
    const buildIncidentInvoice = (overrides: any) => ({
      id: overrides.id,
      organization_id: 1,
      store_id: 2,
      accounting_entity_id: 77,
      invoice_number: 'FV-500',
      invoice_type: 'sales_invoice',
      customer_id: null,
      customer: null,
      supplier_id: null,
      supplier: null,
      // El snapshot de la factura MANUAL — sin ficha vinculada — es la ÚNICA
      // fuente de identidad. Antes de este fix, `send()` no leía estos campos
      // salvo `customer_name`/`customer_tax_id`/`customer_address`.
      customer_name: 'Óptica Panorama SAS',
      customer_tax_id: '800214345',
      customer_document_type: '31',
      customer_verification_digit: '7',
      customer_email: 'facturacion@opticapanorama.co',
      customer_phone: null,
      customer_tax_regime: null,
      customer_fiscal_responsibilities: ['O-48'],
      // Sin `order_id`/`sales_order_id`: es la factura MANUAL del incidente.
      // El fixture por defecto trae una dirección real del snapshot (nunca la
      // de la tienda) para que este describe siga probando identidad sin
      // depender de si la dirección falta o no — desde Task B (2026-09-28) su
      // ausencia ya no bloquea nada (ver el test dedicado, que sobreescribe
      // esto a `null`).
      customer_address: {
        address_line: 'Calle 100 # 20-30',
        municipality_code: '11001',
        city: 'Bogotá',
        department_code: '11',
        state_province: 'Bogotá D.C.',
        country_code: 'CO',
        postal_code: '110111',
      },
      subtotal_amount: { toString: () => '1000.00' },
      discount_amount: { toString: () => '0.00' },
      tax_amount: { toString: () => '190.00' },
      withholding_amount: { toString: () => '0.00' },
      total_amount: { toString: () => '1190.00' },
      currency: 'COP',
      issue_date: new Date('2026-03-10T10:00:00.000Z'),
      due_date: new Date('2026-03-20T00:00:00.000Z'),
      invoice_items: [
        {
          id: 1,
          description: 'Consulta óptica',
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
      resolution: {
        id: 7001,
        resolution_number: '18760000001',
        prefix: 'FV',
        range_from: 1,
        range_to: 999999999,
        valid_from: new Date('2020-01-01T00:00:00.000Z'),
        valid_to: new Date('2035-01-01T00:00:00.000Z'),
        is_active: true,
      },
      related_invoice: null,
      notes: null,
      financial_account_id: null,
      ...overrides,
    });

    it('validate() (validador real) aprueba la factura y send() transmite NIT/31 + DV 7 + jurídica + correo — nunca CC', async () => {
      const findFirst = jest.fn().mockImplementation(async ({ where }: any) =>
        where.id === 501
          ? buildIncidentInvoice({ id: 501, status: 'draft' })
          : buildIncidentInvoice({ id: 502, status: 'validated' }),
      );
      const update = jest.fn().mockImplementation(async ({ where, data }: any) => ({
        ...buildIncidentInvoice({ id: where.id, status: 'validated' }),
        ...data,
      }));

      const { service, provider } = createService({
        prisma: { invoices: { findFirst, update } },
      });
      // ÚNICO mock reemplazado por la implementación REAL: el resto de la
      // infraestructura (Prisma, proveedor, cola de reintentos…) sigue
      // simulada — lo que se ejercita de verdad es la puerta de identidad.
      (service as any).acquirerIdentity = new CustomerFiscalIdentityValidator();
      // El default de `createService` deja `sendInvoice` sin resolver (a
      // diferencia de `sendSupportDocument`); esta factura es `sales_invoice`,
      // así que necesita su propia respuesta de aceptación simulada.
      provider.sendInvoice.mockResolvedValue({
        success: true,
        tracking_id: 'track-fv-500',
        cufe: 'a'.repeat(96),
        qr_code: 'qr',
        xml_document: '<xml/>',
        provider_data: { mock: true },
      });

      // ENTRADA REAL 1 — `validate()`. Si el validador real siguiera viendo
      // esto como Cédula/persona natural incompleta no habría bloqueante que
      // lo delate (el tipo SÍ está declarado), pero de haber cualquier
      // discrepancia con lo que `send()` transmite, este test la vuelve visible
      // comparando ambos resultados sobre la MISMA factura.
      await expect(
        RequestContextService.run(requestContext, () => service.validate(501)),
      ).resolves.toBeDefined();

      // ENTRADA REAL 2 — `send()`.
      await RequestContextService.run(requestContext, () => service.send(502));

      expect(provider.sendInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_tax_id: '800214345',
          // El snapshot trae el CÓDIGO DIAN ('31'); `resolveAcquirerIdentity`
          // lo normaliza al LITERAL canónico ('NIT') antes de que
          // `DianDirectProvider`/`UblCommonBuilder` lo consuman — nunca el
          // código crudo ni, sobre todo, el 'CC' que inventaba el defecto.
          customer_document_type: 'NIT',
          customer_verification_digit: '7',
          customer_person_type: 'JURIDICA',
          customer_email: 'facturacion@opticapanorama.co',
          customer_name: 'Óptica Panorama SAS',
          // P1-A: la dirección transmitida es la del SNAPSHOT de la propia
          // factura manual (municipio Bogotá 11001 declarado por el
          // fixture), nunca la de la tienda emisora — esa cascada de
          // respaldo sólo entra cuando NINGUNA dirección real existe.
          customer_address: expect.objectContaining({
            address_line: 'Calle 100 # 20-30',
            municipality_code: '11001',
          }),
        }),
      );
    });

    it('send(): el update de aceptación re-persiste el snapshot del adquirente que viajó a la DIAN', async () => {
      const findFirst = jest
        .fn()
        .mockResolvedValue(buildIncidentInvoice({ id: 510, status: 'validated' }));
      const update = jest.fn().mockImplementation(async ({ where, data }: any) => ({
        ...buildIncidentInvoice({ id: where.id, status: 'validated' }),
        ...data,
      }));
      const { service, provider } = createService({
        prisma: { invoices: { findFirst, update } },
      });
      provider.sendInvoice.mockResolvedValue({
        success: true,
        tracking_id: 'track-fv-510',
        cufe: 'b'.repeat(96),
        qr_code: 'qr',
        xml_document: '<xml/>',
        provider_data: { mock: true },
      });

      await RequestContextService.run(requestContext, () => service.send(510));

      const accepted = update.mock.calls
        .map(([args]: any[]) => args)
        .find((args: any) => args.data?.status === 'accepted');
      expect(accepted).toBeDefined();
      expect(accepted.data).toEqual(
        expect.objectContaining({
          customer_name: 'Óptica Panorama SAS',
          customer_tax_id: '800214345',
          // Literal canónico que viajó al proveedor, no el código '31'.
          customer_document_type: 'NIT',
          customer_verification_digit: '7',
          customer_email: 'facturacion@opticapanorama.co',
          customer_fiscal_responsibilities: ['O-48'],
          customer_person_type: 'JURIDICA',
        }),
      );
      // Lo que se persiste es exactamente lo que se transmitió.
      const sent = provider.sendInvoice.mock.calls[0][0];
      expect(accepted.data.customer_document_type).toBe(sent.customer_document_type);
      expect(accepted.data.customer_person_type).toBe(sent.customer_person_type);
      // `?? undefined`: un dato ausente no pisa la columna con null.
      expect(accepted.data.customer_phone).toBeUndefined();
    });

    it('Task B: factura MANUAL sin ficha vinculada (NIT) y SIN dirección en el snapshot: validate() real EMITE con aviso no bloqueante (revierte P1-A)', async () => {
      // Mismo incidente Óptica Panorama, pero sin la dirección que el
      // fixture por defecto trae. P1-A (`baa9a4294`) bloqueaba esta
      // combinación (jurídica O manual) con `ADDRESS_UNRESOLVABLE`. Task B
      // (2026-09-28) revierte ese bloqueo: DIAN Res. 000165/2023 art. 69 no
      // permite exigirle dirección al adquiriente, ni siquiera jurídico ni en
      // factura manual, así que su ausencia nunca puede impedir la
      // numeración. `other_addresses` ahora SIEMPRE es `undefined`
      // (`buildAcquirerIdentityInput`), así que `checkAddress` degrada a
      // `ADDRESS_REQUIRED` (aviso), nunca a `ADDRESS_UNRESOLVABLE` (bloqueo).
      const findFirst = jest.fn().mockResolvedValue(
        buildIncidentInvoice({ id: 503, status: 'draft', customer_address: null }),
      );
      const update = jest.fn().mockImplementation(async ({ where, data }: any) => ({
        ...buildIncidentInvoice({ id: where.id, status: 'validated', customer_address: null }),
        ...data,
      }));
      const { service } = createService({
        prisma: { invoices: { findFirst, update } },
      });
      (service as any).acquirerIdentity = new CustomerFiscalIdentityValidator();

      await expect(
        RequestContextService.run(requestContext, () => service.validate(503)),
      ).resolves.toBeDefined();
    });

    // Fixture común a los dos tests "nacidos de orden" (POS/ecommerce) que
    // siguen: MISMA forma que `linkedCustomerNoAddress` (arriba), pero con
    // `order_id` poblado — el carril `sale_rail: 'on_demand'` que nunca captura
    // dirección del cliente en el mostrador.
    const buildPosInvoice = (overrides: any) => ({
      id: overrides.id,
      organization_id: 1,
      store_id: 2,
      accounting_entity_id: 77,
      invoice_number: 'FV-700',
      invoice_type: 'sales_invoice',
      status: 'draft',
      order_id: 900,
      sales_order_id: null,
      supplier_id: null,
      supplier: null,
      customer_name: null,
      customer_tax_id: null,
      customer_document_type: null,
      customer_verification_digit: null,
      customer_email: null,
      customer_phone: null,
      customer_tax_regime: null,
      customer_fiscal_responsibilities: null,
      customer_address: null,
      subtotal_amount: { toString: () => '1000.00' },
      discount_amount: { toString: () => '0.00' },
      tax_amount: { toString: () => '190.00' },
      withholding_amount: { toString: () => '0.00' },
      total_amount: { toString: () => '1190.00' },
      currency: 'COP',
      issue_date: new Date('2026-03-10T10:00:00.000Z'),
      due_date: new Date('2026-03-20T00:00:00.000Z'),
      invoice_items: [
        {
          id: 1,
          description: 'Producto de mostrador',
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
      resolution: {
        id: 7001,
        resolution_number: '18760000001',
        prefix: 'FV',
        range_from: 1,
        range_to: 999999999,
        valid_from: new Date('2020-01-01T00:00:00.000Z'),
        valid_to: new Date('2035-01-01T00:00:00.000Z'),
        is_active: true,
      },
      related_invoice: null,
      notes: null,
      financial_account_id: null,
      ...overrides,
    });

    it('P1-A: POS — persona NATURAL nacida de una orden, SIN dirección propia: validate() real emite (regresión de 1109a03d7)', async () => {
      // Cliente CC registrado sólo con nombre+documento (nunca se le pidió
      // dirección en el POS) — exactamente la regresión reportada: antes de
      // este fix, CUALQUIER `customer_id` vinculado poblaba `other_addresses`
      // y esta venta quedaba bloqueada por `ADDRESS_UNRESOLVABLE`.
      const posInvoice = buildPosInvoice({
        id: 700,
        customer_id: 400,
        customer: {
          id: 400,
          legal_name: null,
          first_name: 'Juan',
          last_name: 'Pérez',
          document_type: 'CC',
          document_number: '1118860776',
          verification_digit: null,
          addresses: [],
        },
      });
      const findFirst = jest.fn().mockResolvedValue(posInvoice);
      const { service } = createService({
        prisma: {
          invoices: {
            findFirst,
            // Este escenario SÍ llega al final feliz de `validate()`
            // (identidad resuelta, ya numerada) — a diferencia de los demás
            // "P1-A: POS" de este bloque, que rechazan antes de este punto.
            // El override reemplaza `invoices` COMPLETO (spread superficial
            // en `createService`), así que sin este mock explícito la llamada
            // real `this.prisma.invoices.update({ data: { status:
            // 'validated' } })` revienta con "is not a function".
            update: jest
              .fn()
              .mockResolvedValue({ ...posInvoice, status: 'validated' }),
          },
        },
      });
      (service as any).acquirerIdentity = new CustomerFiscalIdentityValidator();

      await expect(
        RequestContextService.run(requestContext, () => service.validate(700)),
      ).resolves.toBeDefined();
    });

    it('Task B: POS — persona JURÍDICA (NIT) nacida de una orden, SIN dirección propia: validate() real EMITE con aviso no bloqueante (revierte P1-A)', async () => {
      // P1-A declaraba una excepción para jurídica: aun naciendo de una
      // orden, exigía dirección porque la DIAN la cruza en exógena/
      // retenciones. Task B revierte también esta rama: ese cruce es sobre un
      // dato que el art. 69 le prohíbe al comerciante exigir, así que no
      // puede condicionar la NUMERACIÓN de una venta legítima. El aviso
      // `ADDRESS_REQUIRED` se sigue emitiendo (no bloqueante) para que la UI
      // ofrezca capturarla.
      const posInvoice = buildPosInvoice({
        id: 701,
        customer_id: 401,
        customer: {
          id: 401,
          legal_name: 'Distribuidora Jurídica SAS',
          first_name: null,
          last_name: null,
          document_type: 'NIT',
          document_number: '900555666',
          verification_digit: '1',
          addresses: [],
        },
      });
      const findFirst = jest.fn().mockResolvedValue(posInvoice);
      const { service } = createService({
        prisma: {
          invoices: {
            findFirst,
            update: jest
              .fn()
              .mockResolvedValue({ ...posInvoice, status: 'validated' }),
          },
        },
      });
      (service as any).acquirerIdentity = new CustomerFiscalIdentityValidator();

      await expect(
        RequestContextService.run(requestContext, () => service.validate(701)),
      ).resolves.toBeDefined();
    });

    // Task B (2026-09-28) revierte el requisito #4 del incidente original:
    // ya NO existe una dirección FISCAL de la tienda a la que `send()` pueda
    // caer (`acquirer-address.resolver.ts` eliminó ese escalón), y su
    // ausencia tampoco bloquea `validate()`. `buildAcquirerIdentityInput`
    // ahora SIEMPRE manda `other_addresses: undefined` — nunca el universo de
    // direcciones del cliente — así que `checkAddress` jamás escala a
    // `ADDRESS_UNRESOLVABLE`; sólo deja el aviso `ADDRESS_REQUIRED`.
    it('Task B: adquiriente nominativo con ficha vinculada SIN ninguna dirección propia: validate() real EMITE con aviso no bloqueante', async () => {
      const linkedCustomerNoAddress = {
        id: 601,
        organization_id: 1,
        store_id: 2,
        accounting_entity_id: 77,
        invoice_number: 'FV-600',
        invoice_type: 'sales_invoice',
        status: 'draft',
        customer_id: 300,
        customer: {
          id: 300,
          legal_name: 'Cliente Sin Dirección SAS',
          document_type: 'NIT',
          document_number: '900555666',
          verification_digit: '1',
          // Ficha REAL, vinculada, sin ninguna fila de dirección.
          addresses: [],
        },
        supplier_id: null,
        supplier: null,
        customer_name: null,
        customer_tax_id: null,
        customer_document_type: null,
        customer_verification_digit: null,
        customer_email: null,
        customer_phone: null,
        customer_tax_regime: null,
        customer_fiscal_responsibilities: null,
        customer_address: null,
        subtotal_amount: { toString: () => '1000.00' },
        discount_amount: { toString: () => '0.00' },
        tax_amount: { toString: () => '190.00' },
        withholding_amount: { toString: () => '0.00' },
        total_amount: { toString: () => '1190.00' },
        currency: 'COP',
        issue_date: new Date('2026-03-10T10:00:00.000Z'),
        due_date: new Date('2026-03-20T00:00:00.000Z'),
        invoice_items: [
          {
            id: 1,
            description: 'Servicio',
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
        resolution: null,
        related_invoice: null,
        notes: null,
      };

      const { service } = createService({
        prisma: {
          invoices: {
            findFirst: jest.fn().mockResolvedValue(linkedCustomerNoAddress),
            update: jest
              .fn()
              .mockImplementation(async ({ where, data }: any) => ({
                ...linkedCustomerNoAddress,
                ...data,
                id: where.id,
              })),
          },
        },
      });
      (service as any).acquirerIdentity = new CustomerFiscalIdentityValidator();

      await expect(
        RequestContextService.run(requestContext, () => service.validate(601)),
      ).resolves.toBeDefined();
    });
  });
});

// PR #858 hallazgo 2 — el cobro de la orden ya persistió la retención
// SUFRIDA con `invoice_id: null` + `order_id`. Al aceptarse la factura de esa
// orden se ENLAZAN esas filas (updateMany con `invoice_id`) y no se inserta
// otra `suffered`; `self` sigue insertándose. Sin filas previas, o sin orden,
// se inserta como siempre.
describe('InvoiceFlowService.persistWithholdingBatches — enlace de la sufrida del cobro', () => {
  const sufferedLine = {
    withholding_type: 'retefuente',
    concept_code: 'RF-COMPRAS',
    concept_id: 5,
    rate: 0.025,
    base: 100000,
    amount: 2500,
    role: 'suffered',
    account_role: 'withholding.suffered.retefuente_receivable',
  } as any;
  const selfLine = {
    ...sufferedLine,
    concept_code: 'AUTO',
    concept_id: 6,
    role: 'self',
    amount: 400,
    account_role: 'withholding.self.retefuente_payable',
  } as any;
  const batches = [
    {
      role: 'suffered',
      resolution: { lines: [sufferedLine], uvt_value_used: 49799, counterparty_type: 'juridica' },
    },
    {
      role: 'self',
      resolution: { lines: [selfLine], uvt_value_used: 49799, counterparty_type: null },
    },
  ];
  const invoice = {
    id: 300,
    organization_id: 1,
    store_id: 2,
    accounting_entity_id: 77,
    customer_id: 44,
    supplier_id: null,
    order_id: 900,
  };

  const build = (priorRows: Array<{ id: number }>) => {
    const prisma = {
      withholding_calculations: {
        findMany: jest.fn().mockResolvedValue(priorRows),
        updateMany: jest.fn().mockResolvedValue({ count: priorRows.length }),
      },
    };
    const withholdingFlow = {
      persistWithholdingLines: jest.fn().mockResolvedValue(undefined),
    };
    const service = new InvoiceFlowService(
      prisma as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      withholdingFlow as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma, withholdingFlow };
  };

  it('con filas sufridas previas de la orden: las enlaza y no inserta suffered', async () => {
    const { service, prisma, withholdingFlow } = build([{ id: 11 }, { id: 12 }]);

    const breakdown = await (service as any).persistWithholdingBatches(invoice, batches);

    expect(prisma.withholding_calculations.findMany).toHaveBeenCalledWith({
      where: { organization_id: 1, order_id: 900, role: 'suffered', invoice_id: null },
      select: { id: true },
    });
    expect(prisma.withholding_calculations.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [11, 12] } },
      data: { invoice_id: 300, accounting_entity_id: 77 },
    });
    const persistedRoles = withholdingFlow.persistWithholdingLines.mock.calls.map(
      (call: any[]) => call[0].role,
    );
    expect(persistedRoles).toEqual(['self']);
    // El payload de `invoice.accepted` no cambia respecto del histórico.
    expect(breakdown).toEqual([sufferedLine, selfLine]);
  });

  it('sin filas previas: inserta la suffered como siempre', async () => {
    const { service, prisma, withholdingFlow } = build([]);

    await (service as any).persistWithholdingBatches(invoice, batches);

    expect(prisma.withholding_calculations.updateMany).not.toHaveBeenCalled();
    const persistedRoles = withholdingFlow.persistWithholdingLines.mock.calls.map(
      (call: any[]) => call[0].role,
    );
    expect(persistedRoles).toEqual(['suffered', 'self']);
    expect(withholdingFlow.persistWithholdingLines.mock.calls[0][0]).toMatchObject({
      invoice_id: 300,
      customer_id: 44,
      lines: [sufferedLine],
    });
  });

  it('factura sin orden: ni busca filas previas, inserta como siempre', async () => {
    const { service, prisma, withholdingFlow } = build([{ id: 11 }]);

    await (service as any).persistWithholdingBatches({ ...invoice, order_id: null }, batches);

    expect(prisma.withholding_calculations.findMany).not.toHaveBeenCalled();
    expect(prisma.withholding_calculations.updateMany).not.toHaveBeenCalled();
    expect(withholdingFlow.persistWithholdingLines).toHaveBeenCalledTimes(2);
  });
});
