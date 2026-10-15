import { InvoicingService } from './invoicing.service';
import { InvoicingController } from './invoicing.controller';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException } from '../../../common/errors';

/**
 * Correo del adquiriente OBLIGATORIO en la creación MANUAL de factura
 * (`POST store/invoicing` → `create(dto, { require_acquirer_email: true })`).
 *
 * Se fija:
 *   - falta → 400 `INVOICING_ACQUIRER_EMAIL_REQUIRED`, ANTES de crear el
 *     cliente en línea o tomar consecutivo;
 *   - formato inválido → 400 `INVOICING_ACQUIRER_EMAIL_INVALID`;
 *   - correo heredado de la ficha vinculada o del `inline_customer` → pasa;
 *   - consumidor final (222222222222 o sin número de documento) → exento;
 *   - `create(dto)` sin la opción (notas plataforma) y `createFromOrder` no
 *     exigen correo; el controller sólo activa la opción al emitir inmediatamente.
 *
 * Para no simular toda la creación, el paso siguiente a la compuerta
 * (`assertCustomerResolvable` / `createInlineCustomer`) lanza un centinela:
 * recibirlo prueba que la compuerta dejó pasar.
 */
describe('InvoicingService.create — correo del adquiriente (factura manual)', () => {
  const PAST_GATE = new Error('PAST_GATE');

  let usersFindFirst: jest.Mock;
  let generateNextNumber: jest.Mock;
  let service: InvoicingService;
  let createInlineCustomer: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 3, store_id: 7 } as any);
    usersFindFirst = jest.fn();
    generateNextNumber = jest.fn();
    service = new InvoicingService(
      { users: { findFirst: usersFindFirst } } as any,
      { generateNextNumber } as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const s = service as any;
    jest.spyOn(s, 'assertInvoicingAreaActive').mockResolvedValue(undefined);
    jest
      .spyOn(s, 'resolveAccountingEntityIdForContext')
      .mockResolvedValue(11);
    jest.spyOn(s, 'assertFiscalPeriodOpen').mockResolvedValue(undefined);
    jest.spyOn(s, 'loadSupportDocumentSupplier').mockResolvedValue(null);
    jest.spyOn(s, 'loadSupportAdjustmentOriginal').mockResolvedValue(null);
    jest.spyOn(s, 'assertCustomerResolvable').mockRejectedValue(PAST_GATE);
    createInlineCustomer = jest
      .spyOn(s, 'createInlineCustomer')
      .mockRejectedValue(PAST_GATE);
  });

  afterEach(() => jest.restoreAllMocks());

  const baseDto = (extra: Record<string, unknown> = {}) =>
    ({
      invoice_type: 'sales_invoice',
      issue_date: '2026-10-14',
      customer_name: 'Constructora Andina SAS',
      customer_tax_id: '900123456',
      customer_document_type: 'NIT',
      items: [{ description: 'Servicio', quantity: 1, unit_price: 1000 }],
      ...extra,
    }) as any;

  const manual = (dto: any) =>
    service.create(dto, { require_acquirer_email: true });

  async function expectCode(promise: Promise<unknown>, code: string) {
    const err = await promise.then(
      () => {
        throw new Error('se esperaba rechazo');
      },
      (e) => e,
    );
    expect(err).toBeInstanceOf(VendixHttpException);
    expect((err as VendixHttpException).errorCode).toBe(code);
    expect((err as VendixHttpException).getStatus()).toBe(400);
  }

  it('sin correo en ninguna fuente → 400 INVOICING_ACQUIRER_EMAIL_REQUIRED, antes de numerar', async () => {
    await expectCode(manual(baseDto()), 'INVOICING_ACQUIRER_EMAIL_REQUIRED');
    expect(generateNextNumber).not.toHaveBeenCalled();
  });

  it('correo en blanco cuenta como ausente', async () => {
    await expectCode(
      manual(baseDto({ customer_email: '   ' })),
      'INVOICING_ACQUIRER_EMAIL_REQUIRED',
    );
  });

  it('cliente en línea sin correo → 400 y NO se crea el cliente', async () => {
    await expectCode(
      manual(
        baseDto({
          customer_name: undefined,
          customer_tax_id: undefined,
          customer_document_type: undefined,
          inline_customer: {
            document_type: 'NIT',
            document_number: '900123456',
            legal_name: 'Constructora Andina SAS',
          },
        }),
      ),
      'INVOICING_ACQUIRER_EMAIL_REQUIRED',
    );
    expect(createInlineCustomer).not.toHaveBeenCalled();
  });

  it('formato inválido heredado de la ficha → 400 INVOICING_ACQUIRER_EMAIL_INVALID', async () => {
    usersFindFirst.mockResolvedValue({
      email: 'compras@andina',
      document_type: 'NIT',
      document_number: '900123456',
      legal_name: 'Constructora Andina SAS',
    });
    await expectCode(
      manual(
        baseDto({
          customer_id: 41,
          customer_name: undefined,
          customer_tax_id: undefined,
        }),
      ),
      'INVOICING_ACQUIRER_EMAIL_INVALID',
    );
  });

  it('correo explícito válido → pasa', async () => {
    await expect(
      manual(baseDto({ customer_email: 'compras@andina.co' })),
    ).rejects.toBe(PAST_GATE);
  });

  it('correo heredado del cliente vinculado (customer_id) → pasa', async () => {
    usersFindFirst.mockResolvedValue({
      email: 'compras@andina.co',
      document_type: 'NIT',
      document_number: '900123456',
      legal_name: 'Constructora Andina SAS',
    });
    await expect(
      manual(
        baseDto({
          customer_id: 41,
          customer_name: undefined,
          customer_tax_id: undefined,
        }),
      ),
    ).rejects.toBe(PAST_GATE);
    expect(usersFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 41, organization_id: 3 },
      }),
    );
  });

  it('correo del inline_customer → pasa (y entonces sí se crea el cliente)', async () => {
    await expect(
      manual(
        baseDto({
          inline_customer: {
            document_type: 'NIT',
            document_number: '900123456',
            legal_name: 'Constructora Andina SAS',
            email: 'compras@andina.co',
          },
        }),
      ),
    ).rejects.toBe(PAST_GATE);
    expect(createInlineCustomer).toHaveBeenCalledTimes(1);
  });

  it('customer_id inexistente: la compuerta cede y lo rechaza assertCustomerResolvable', async () => {
    usersFindFirst.mockResolvedValue(null);
    await expect(manual(baseDto({ customer_id: 999 }))).rejects.toBe(
      PAST_GATE,
    );
  });

  it('consumidor final 222222222222 sin correo → exento', async () => {
    await expect(
      manual(
        baseDto({
          customer_name: 'Consumidor Final',
          customer_tax_id: '222222222222',
          customer_document_type: 'CC',
        }),
      ),
    ).rejects.toBe(PAST_GATE);
  });

  it('venta sin adquiriente declarado (carril consumidor final) → exenta', async () => {
    await expect(
      manual(
        baseDto({
          customer_name: undefined,
          customer_tax_id: undefined,
          customer_document_type: undefined,
        }),
      ),
    ).rejects.toBe(PAST_GATE);
  });

  it('sin número de documento pero con tipo por defecto y nombre (convención de la pantalla) → exenta', async () => {
    await expect(
      manual(
        baseDto({
          customer_name: 'Mostrador',
          customer_tax_id: undefined,
          customer_document_type: 'NIT',
        }),
      ),
    ).rejects.toBe(PAST_GATE);
  });

  it('cliente vinculado con documento 222222222222 → exento', async () => {
    usersFindFirst.mockResolvedValue({
      email: null,
      document_type: 'CC',
      document_number: '222222222222',
      first_name: 'Consumidor',
      last_name: 'Final',
    });
    await expect(
      manual(
        baseDto({
          customer_id: 5,
          customer_name: undefined,
          customer_tax_id: undefined,
          customer_document_type: undefined,
        }),
      ),
    ).rejects.toBe(PAST_GATE);
  });

  it('documento soporte (lado compra) no exige correo del adquiriente', async () => {
    await expect(
      manual(baseDto({ invoice_type: 'support_document' })),
    ).rejects.toBe(PAST_GATE);
  });

  it('create(dto) SIN la opción (notas plataforma, llamadores internos) no exige correo', async () => {
    await expect(service.create(baseDto())).rejects.toBe(PAST_GATE);
    expect(usersFindFirst).not.toHaveBeenCalled();
  });

  it('validar/enviar un borrador nominativo sin correo se rechaza con el mismo código', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue(baseDto({ id: 91 }) as any);
    await expectCode(service.assertPersistedAcquirerEmail(91), 'INVOICING_ACQUIRER_EMAIL_REQUIRED');
  });

  it('validar/enviar consumidor final sin correo sigue exento', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue(baseDto({ id: 91, customer_tax_id: '222222222222' }) as any);
    await expect(service.assertPersistedAcquirerEmail(91)).resolves.toBeUndefined();
  });

  it('createFromOrder (flujo automático) nunca pasa por la compuerta', async () => {
    const gate = jest.spyOn(service as any, 'assertManualInvoiceAcquirerEmail');
    (service as any).prisma.orders = {
      findFirst: jest.fn().mockRejectedValue(PAST_GATE),
    };
    await expect(service.createFromOrder(1)).rejects.toBe(PAST_GATE);
    expect(gate).not.toHaveBeenCalled();
  });
});

describe('InvoicingController — cableado de la compuerta de correo', () => {
  const build = (invoicing: any) =>
    new InvoicingController(
      invoicing,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { success: jest.fn((data) => ({ data })) } as any,
      {} as any,
      // ManualInvoiceEmissionService: sólo corre con `emit_immediately`.
      {} as any,
    );

  it('POST store/invoicing permite guardar borrador sin correo', async () => {
    const invoicing = { create: jest.fn().mockResolvedValue({ id: 1 }) };
    const dto = { invoice_type: 'sales_invoice' } as any;
    await build(invoicing).create(dto);
    expect(invoicing.create).toHaveBeenCalledWith(dto, {
      require_acquirer_email: false,
    });
  });

  it('emit_immediately exige correo antes de crear', async () => {
    const dto = { invoice_type: 'sales_invoice', emit_immediately: true } as any;
    const invoicing = { create: jest.fn().mockRejectedValue(new Error('correo requerido')) };
    await expect(build(invoicing).create(dto)).rejects.toThrow('correo requerido');
    expect(invoicing.create).toHaveBeenCalledWith(dto, { require_acquirer_email: true });
  });

  it.each(['validate', 'send'] as const)('%s comprueba correo antes de emitir el borrador guardado', async (method) => {
    const assertPersistedAcquirerEmail = jest.fn().mockRejectedValue(new Error('correo requerido'));
    const controller = build({ assertPersistedAcquirerEmail });
    await expect(controller[method](1)).rejects.toThrow('correo requerido');
    expect(assertPersistedAcquirerEmail).toHaveBeenCalledWith(1);
  });

  it('POST from-order delega sin opción de correo', async () => {
    const invoicing = {
      createFromOrder: jest.fn().mockResolvedValue({ id: 2 }),
    };
    await build(invoicing).createFromOrder(9);
    expect(invoicing.createFromOrder).toHaveBeenCalledWith(9);
  });
});
