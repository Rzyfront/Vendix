import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../common/context/request-context.service';
import { InvoicingService } from './invoicing.service';
import {
  CreateInvoiceDto,
  CreateInvoiceItemDto,
} from './dto/create-invoice.dto';
import {
  InvoiceCalculatorAiuInput,
  InvoiceCalculatorResult,
  InvoiceCalculatorService,
} from './services/invoice-calculator.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

describe('InvoicingService support adjustment notes', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const supplier = {
    id: 50,
    name: 'Proveedor No Obligado',
    tax_id: '123456789',
    document_type: 'CC',
    tax_regime: 'no_responsable_iva',
    verification_digit: null,
    addresses: {
      address_line1: 'Carrera 4 # 5-6',
      address_line2: null,
      city: 'Bogota',
      state_province: 'Bogota',
      country_code: 'CO',
      postal_code: '110111',
      municipality_code: '11001',
      phone_number: null,
    },
  };

  const dto: CreateInvoiceDto = {
    invoice_type: 'support_adjustment_note',
    supplier_id: 50,
    related_invoice_id: 100,
    issue_date: '2026-03-12',
    currency: 'COP',
    withholding_amount: 0,
    notes: 'Ajuste documento soporte',
    items: [
      {
        description: 'Ajuste servicio',
        quantity: 1,
        unit_price: 1000,
        discount_amount: 0,
        tax_amount: 0,
      },
    ],
    taxes: [],
  };

  const createService = (overrides: any = {}) => {
    const prisma = {
      suppliers: {
        findFirst: jest.fn().mockResolvedValue(supplier),
      },
      invoices: {
        findFirst: jest.fn().mockResolvedValue({
          id: 100,
          invoice_number: 'DS100',
          invoice_type: 'support_document',
          status: 'accepted',
          cufe: 'original-cuds',
        }),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 200,
          invoice_number: data.invoice_number,
          related_invoice_id: data.related_invoice_id,
          customer_name: data.customer_name,
          customer_tax_id: data.customer_tax_id,
          customer_address: data.customer_address,
        })),
      },
      fiscal_close_sessions: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // The live-emission check reads the DIAN configuration outside the tenant
      // scope. Returning null means "no habilitación", which is the state these
      // cases assume — they assert numbering and linkage, not transmission.
      withoutScope: () => ({
        dian_configurations: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      }),
      ...overrides.prisma,
    };
    const generator = {
      generateNextNumber: jest.fn().mockResolvedValue({
        invoice_number: 'NADS100',
        resolution_id: 88,
      }),
    };
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const fiscalScope = {
      resolveAccountingEntityForFiscal: jest.fn().mockResolvedValue({ id: 77 }),
      // Default tenant shape: fiscal identity lives at the store, which is what
      // every case in this file assumes.
      requireFiscalScope: jest.fn().mockResolvedValue('STORE'),
      getFiscalScope: jest.fn().mockResolvedValue('STORE'),
      ...overrides.fiscalScope,
    };
    const retryQueue = {
      getRetryStatusByInvoiceIds: jest.fn().mockResolvedValue(new Map()),
      ...overrides.retryQueue,
    };

    // Defaults to "everything enabled" so these tests keep exercising the
    // business flow; a test that wants the gate closed overrides it.
    const fiscalGate = {
      isAreaEnabled: jest.fn().mockResolvedValue(true),
      isSubflowEnabled: jest.fn().mockResolvedValue(true),
      ...overrides.fiscalGate,
    };

    return {
      service: new InvoicingService(
        prisma as any,
        generator as any,
        eventEmitter,
        fiscalScope as any,
        retryQueue as any,
        fiscalGate as any,
        // Compuerta de emisión extraída a `InvoiceEmissionGateService` en el
        // commit `9cb5aff05`: `InvoicingService` ya no lleva el predicado, lo
        // delega. Se pasa permisiva porque ninguno de estos casos prueba la
        // compuerta en sí — la prueban `invoice-emission-gate.service.spec.ts`
        // y sus propios casos. Omitirla no da un fallo de aserción, da un
        // `TS2554` que tumba la suite entera y no aparece en el conteo de
        // `Tests:`, que es como pasó desapercibida.
        {
          assertAreaActive: jest.fn().mockResolvedValue(undefined),
          assertElectronicEmissionLive: jest.fn().mockResolvedValue(undefined),
        } as any,
        // El umbral 5 UVT no participa en ninguno de estos flujos; se pasa
        // desactivado para que el constructor quede completo sin alterarlos.
        {
          evaluate: jest.fn().mockResolvedValue({
            enforced: false,
            uvt_value: null,
            limit_cop: null,
            exceeds: false,
            year: new Date().getFullYear(),
          }),
          assertInvoiceNotRequired: jest.fn(),
        } as any,
        // Instancia REAL, no un doble: el motor aritmético es puro (sin Prisma,
        // sin contexto, sin HTTP) y mockearlo dejaría los importes que persiste
        // `create()` sin cubrir, que es exactamente el defecto que vino a
        // cerrar.
        new InvoiceCalculatorService(),
        // TRM: doble que NUNCA sale a la red. Ninguno de estos casos factura en
        // divisa, y una instancia real dejaría los tests dependiendo de que
        // datos.gov.co responda.
        {
          resolveExchangeRate: jest.fn().mockResolvedValue(null),
          getTrm: jest.fn().mockResolvedValue(null),
          ...overrides.trm,
        } as any,
        // Retenciones: por defecto NO hay ninguna resuelta, que es el caso de
        // una tienda sin conceptos configurados y el que estos flujos asumen.
        {
          resolveSuffered: jest.fn().mockResolvedValue({
            lines: [],
            uvt_value_used: 0,
            counterparty_type: null,
          }),
          resolveSelf: jest.fn().mockResolvedValue({
            lines: [],
            uvt_value_used: 0,
            counterparty_type: null,
          }),
          persistWithholdingLines: jest.fn().mockResolvedValue(undefined),
          ...overrides.withholdingFlow,
        } as any,
      ),
      prisma,
      generator,
      eventEmitter,
      retryQueue,
      fiscalGate,
    };
  };

  it('requires an accepted original support document', async () => {
    const { service, generator } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            id: 100,
            invoice_number: 'DS100',
            invoice_type: 'support_document',
            status: 'validated',
            cufe: null,
          }),
        },
      },
    });

    await expect(
      RequestContextService.run(requestContext, () => service.create(dto)),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_STATUS_002' });
    expect(generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('blocks creation when the fiscal period is closed', async () => {
    const { service, generator } = createService({
      prisma: {
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
      RequestContextService.run(requestContext, () => service.create(dto)),
    ).rejects.toMatchObject({ errorCode: 'FISCAL_ACCOUNTING_BLOCKED' });
    expect(generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('links the adjustment note to the accepted original support document', async () => {
    const { service, prisma, generator } = createService();

    const result = await RequestContextService.run(requestContext, () =>
      service.create(dto),
    );

    expect(generator.generateNextNumber).toHaveBeenCalledWith({
      resolution_id: undefined,
      document_type: 'support_adjustment_note',
      accounting_entity_id: 77,
    });
    expect(prisma.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoice_number: 'NADS100',
          invoice_type: 'support_adjustment_note',
          related_invoice_id: 100,
          customer_name: 'Proveedor No Obligado',
          customer_tax_id: '123456789',
          customer_address: supplier.addresses,
        }),
      }),
    );
    expect(result.related_invoice_id).toBe(100);
  });

  describe('findAll retry_status', () => {
    const invoices = [
      {
        id: 1,
        send_status: 'sent_error',
        transmission_status: 'error',
      },
      {
        id: 2,
        send_status: 'sent_ok',
        transmission_status: 'accepted',
      },
      {
        id: 3,
        send_status: 'sent_error',
        transmission_status: 'error',
      },
    ];

    const createListService = (retryMap: Map<number, any>) =>
      createService({
        prisma: {
          invoices: {
            findMany: jest.fn().mockResolvedValue(invoices),
            count: jest.fn().mockResolvedValue(invoices.length),
          },
        },
        retryQueue: {
          getRetryStatusByInvoiceIds: jest.fn().mockResolvedValue(retryMap),
        },
      });

    it('resolves retry_status in batch only for error/pending invoices, null otherwise', async () => {
      const retry_status = {
        status: 'pending',
        attempts: 1,
        max_attempts: 3,
        last_error: 'ETIMEDOUT',
        next_retry_at: new Date('2026-06-09T12:00:00.000Z'),
      };
      const { service, retryQueue } = createListService(
        new Map([[1, retry_status]]),
      );

      const result = await service.findAll({ page: 1, limit: 10 } as any);

      // One batch call with only the error/pending IDs of the page (no N+1).
      expect(retryQueue.getRetryStatusByInvoiceIds).toHaveBeenCalledTimes(1);
      expect(retryQueue.getRetryStatusByInvoiceIds).toHaveBeenCalledWith([
        1, 3,
      ]);

      expect(result.data[0].retry_status).toEqual(retry_status);
      // Accepted invoice: never queried, retry_status null.
      expect(result.data[1].retry_status).toBeNull();
      // Error invoice not present in the queue: retry_status null.
      expect(result.data[2].retry_status).toBeNull();
    });
  });
});

/**
 * D.4 revisitado — un contrato AIU puede facturar VARIOS servicios, así que el
 * documento admite N líneas `aiu_component: 'contrato'` (Modelo 1). Lo que
 * `recalculateDocument` sigue frenando es MEZCLAR el Modelo 1 con el Modelo 2
 * (líneas por componente), porque el primero lleva el AIU dentro del importe de
 * la línea y el segundo lo suma aparte: combinarlos contaría el mismo AIU dos
 * veces.
 *
 * Se instancia por prototipo, igual que
 * `invoicing.service.aiu-contrato-exclusivity.spec.ts`: `recalculateDocument`
 * sólo toca `this.calculator` y `this.applyTaxCatalogToLine` (que retorna
 * temprano con el catálogo vacío), y el `throw` ocurre antes de cualquier
 * lectura a Prisma. Levantar el grafo de dependencias mediría el grafo, no la
 * regla.
 */
describe('InvoicingService · N líneas Modelo 1 en un documento (D.4)', () => {
  /**
   * Superficie privada bajo prueba, declarada en vez de casteada a `any` para
   * que un cambio de firma de `recalculateDocument` rompa la compilación de
   * esta suite en lugar de dejarla verde midiendo otra cosa.
   */
  interface RecalculateHarness {
    calculator: InvoiceCalculatorService;
    logger: Pick<Logger, 'warn'>;
    recalculateDocument(
      items: CreateInvoiceItemDto[],
      snapshots: { price_unit_quantity?: number }[],
      label: string,
      aiu?: InvoiceCalculatorAiuInput,
    ): InvoiceCalculatorResult;
  }

  const buildHarness = (): RecalculateHarness => {
    const service = Object.create(
      InvoicingService.prototype,
    ) as RecalculateHarness;
    // Instancia REAL: el motor es puro y mockearlo dejaría sin cubrir las
    // divergencias que esta regla decide ignorar o traducir.
    service.calculator = new InvoiceCalculatorService();
    // El logger SÍ hace falta: `recalculateDocument` avisa por él cuando su
    // lectura de la mezcla y la del calculador no coinciden, y sin el doble esa
    // traza tumbaría el caso que debe pasar. El calculador ya NO reporta
    // `aiu_contrato_mutually_exclusive` por el mero conteo de líneas
    // «contrato» —esa es la regla que cambió—: sólo cuando de verdad se
    // mezclan los dos modelos.
    service.logger = { warn: jest.fn() };
    return service;
  };

  const aiu: InvoiceCalculatorAiuInput = {
    taxable_basis: 'aiu',
    components: {
      administracion: 6,
      imprevistos: 1,
      utilidad: 3,
    },
    components_basis: 'contract',
  };

  const item = (
    overrides: Partial<CreateInvoiceItemDto>,
  ): CreateInvoiceItemDto =>
    ({
      description: 'Servicio del contrato',
      quantity: 1,
      unit_price: 10_000_000,
      // Con impuesto declarado para que el caso no caiga en `INVOICING_AIU_004`
      // (componente gravable sin impuesto), que no es lo que estas pruebas
      // aíslan.
      taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
      ...overrides,
    }) as CreateInvoiceItemDto;

  it('Modelo 1: dos líneas «contrato» en el mismo documento ya NO se rechazan', () => {
    const harness = buildHarness();
    const items = [
      item({ description: 'Aseo', aiu_component: 'contrato' }),
      item({ description: 'Vigilancia', aiu_component: 'contrato' }),
    ];

    expect(() =>
      harness.recalculateDocument(items, [], 'factura', aiu),
    ).not.toThrow();
  });

  it('Modelo 1: las dos líneas «contrato» conservan su propio importe (el total no se consolida)', () => {
    const harness = buildHarness();
    const items = [
      item({
        description: 'Aseo',
        aiu_component: 'contrato',
        unit_price: 2_328_800,
      }),
      item({
        description: 'Vigilancia',
        aiu_component: 'contrato',
        unit_price: 1_000_000,
      }),
    ];

    const result = harness.recalculateDocument(items, [], 'factura', aiu);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].line_extension_amount.toString()).toBe('2328800.00');
    expect(result.lines[1].line_extension_amount.toString()).toBe('1000000.00');
  });

  it('Modelo 1 mezclado con Modelo 2 («contrato» + «utilidad») sigue devolviendo INVOICING_AIU_007', () => {
    const harness = buildHarness();
    const items = [
      item({ description: 'Aseo', aiu_component: 'contrato' }),
      item({ description: 'Utilidad', aiu_component: 'utilidad' }),
    ];

    let thrown: unknown;
    try {
      harness.recalculateDocument(items, [], 'factura', aiu);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(VendixHttpException);
    const failure = thrown as VendixHttpException;
    expect(failure.errorCode).toBe(ErrorCodes.INVOICING_AIU_007.code);
    // El mensaje nombra los DOS modelos y la línea infractora: sin eso el
    // operador no sabe cuál de los dos renglones corregir.
    expect(failure.message).toContain('Modelo 1');
    expect(failure.message).toContain('Modelo 2');
    expect(failure.message).toContain('La línea 2');
  });

  it('Modelo 1 mezclado con Modelo 2 se detecta aunque haya VARIAS líneas «contrato»', () => {
    // El calculador corta al contar más de una «contrato» y nunca llega a
    // reportar la mezcla; por eso `recalculateDocument` la deriva de los
    // `items` y no de las divergencias.
    const harness = buildHarness();
    const items = [
      item({ description: 'Aseo', aiu_component: 'contrato' }),
      item({ description: 'Vigilancia', aiu_component: 'contrato' }),
      item({ description: 'Administración', aiu_component: 'administracion' }),
    ];

    let thrown: unknown;
    try {
      harness.recalculateDocument(items, [], 'factura', aiu);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(VendixHttpException);
    expect((thrown as VendixHttpException).errorCode).toBe(
      ErrorCodes.INVOICING_AIU_007.code,
    );
    expect((thrown as VendixHttpException).message).toContain('La línea 3');
  });
});
