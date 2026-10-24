import { VendixHttpException } from '../../../../common/errors';
import { PlatformInvoicingService } from './platform-invoicing.service';
import { SubscriptionFiscalController } from './subscription-fiscal.controller';

/**
 * Correo del adquiriente OBLIGATORIO en la factura de venta MANUAL del riel
 * plataforma:
 *   - `POST superadmin/fiscal/sales-invoices` → `PlatformInvoicingService.createSalesInvoice`
 *     (correo efectivo = `customer.email` del formulario → correo del tenant).
 *   - `POST superadmin/subscriptions/fiscal/invoices` (legacy) → controller.
 *
 * La emisión automática de suscripciones (`issueForInvoice`) no pasa por
 * ninguno de los dos.
 */
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

describe('PlatformInvoicingService.createSalesInvoice — correo del adquiriente', () => {
  let createPlatformInvoice: jest.Mock;
  let getTenantByKindAndId: jest.Mock;
  let service: PlatformInvoicingService;

  const legacyResult = {
    transmission_id: 55,
    fiscal_number: 'VNDS1',
    transmission_status: 'accepted',
    dian_status: 'accepted',
    cufe: 'abc',
    accepted: true,
    error_message: null,
  };

  const args = (customer: Record<string, unknown>) => ({
    organizationId: 1,
    accountingEntityId: 2,
    dianConfigurationId: 3,
    actorUserId: 0,
    dto: {
      customer,
      items: [{ description: 'Plan Pro', quantity: 1, unit_price: 100000 }],
    },
  });

  const external = {
    kind: 'external',
    legal_name: 'Constructora Andina SAS',
    tax_id: '900123456',
    tax_id_dv: '8',
    document_type: '31',
  };

  const storeTenant = {
    kind: 'store',
    tenant_id: 4,
    legal_name: 'Tienda Demo SAS',
    tax_id: '900111222',
    tax_id_dv: '1',
    document_type: '31',
    person_type: '1',
    fiscal_responsibilities: ['O-13'],
    address: null,
  };

  beforeEach(() => {
    createPlatformInvoice = jest.fn().mockResolvedValue(legacyResult);
    getTenantByKindAndId = jest.fn();
    service = new PlatformInvoicingService(
      { platform_customers: { upsert: jest.fn().mockResolvedValue({}) } } as any,
      {} as any,
      {} as any,
      {} as any,
      { getTenantByKindAndId } as any,
      { createPlatformInvoice } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('cliente externo sin correo → 400 INVOICING_ACQUIRER_EMAIL_REQUIRED y no emite', async () => {
    await expectCode(
      service.createSalesInvoice(args(external)),
      'INVOICING_ACQUIRER_EMAIL_REQUIRED',
    );
    expect(createPlatformInvoice).not.toHaveBeenCalled();
  });

  it('cliente externo con correo inválido → 400 INVOICING_ACQUIRER_EMAIL_INVALID', async () => {
    await expectCode(
      service.createSalesInvoice(args({ ...external, email: 'compras@' })),
      'INVOICING_ACQUIRER_EMAIL_INVALID',
    );
    expect(createPlatformInvoice).not.toHaveBeenCalled();
  });

  it('cliente externo con correo válido → emite', async () => {
    await service.createSalesInvoice(
      args({ ...external, email: 'compras@andina.co' }),
    );
    expect(createPlatformInvoice).toHaveBeenCalledTimes(1);
  });

  it('tenant sin correo en ficha ni formulario → 400 y no emite', async () => {
    getTenantByKindAndId.mockResolvedValue({ ...storeTenant, email: null });
    await expectCode(
      service.createSalesInvoice(args({ kind: 'store', tenant_id: 4 })),
      'INVOICING_ACQUIRER_EMAIL_REQUIRED',
    );
    expect(createPlatformInvoice).not.toHaveBeenCalled();
  });

  it('correo heredado de la ficha del tenant → emite', async () => {
    getTenantByKindAndId.mockResolvedValue({
      ...storeTenant,
      email: 'admin@tiendademo.co',
    });
    await service.createSalesInvoice(args({ kind: 'store', tenant_id: 4 }));
    expect(createPlatformInvoice).toHaveBeenCalledTimes(1);
  });

  it('el correo del formulario completa una ficha de tenant sin correo → emite', async () => {
    getTenantByKindAndId.mockResolvedValue({ ...storeTenant, email: null });
    await service.createSalesInvoice(
      args({ kind: 'store', tenant_id: 4, email: 'pagos@tiendademo.co' }),
    );
    expect(createPlatformInvoice).toHaveBeenCalledTimes(1);
  });

  it('consumidor final 222222222222 → exento', async () => {
    await service.createSalesInvoice(
      args({
        ...external,
        legal_name: 'Consumidor Final',
        tax_id: '222222222222',
        document_type: '13',
      }),
    );
    expect(createPlatformInvoice).toHaveBeenCalledTimes(1);
  });
});

describe('SubscriptionFiscalController.createPlatformInvoice (legacy manual) — correo del adquiriente', () => {
  let fiscalService: { createPlatformInvoice: jest.Mock };
  let controller: SubscriptionFiscalController;

  const dto = (customer: Record<string, unknown>) =>
    ({
      customer: {
        legal_name: 'Constructora Andina SAS',
        tax_id: '900123456',
        tax_id_dv: '8',
        ...customer,
      },
      items: [{ description: 'Servicio', quantity: 1, unit_price: 1000 }],
    }) as any;

  beforeEach(() => {
    fiscalService = {
      createPlatformInvoice: jest.fn().mockResolvedValue({ invoice_id: 1 }),
    };
    controller = new SubscriptionFiscalController(
      fiscalService as any,
      { created: jest.fn((data) => ({ data })) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('sin correo → 400 INVOICING_ACQUIRER_EMAIL_REQUIRED y no llega al servicio', async () => {
    await expectCode(
      controller.createPlatformInvoice(dto({})),
      'INVOICING_ACQUIRER_EMAIL_REQUIRED',
    );
    expect(fiscalService.createPlatformInvoice).not.toHaveBeenCalled();
  });

  it('correo inválido → 400 INVOICING_ACQUIRER_EMAIL_INVALID', async () => {
    await expectCode(
      controller.createPlatformInvoice(dto({ email: 'no-es-correo' })),
      'INVOICING_ACQUIRER_EMAIL_INVALID',
    );
    expect(fiscalService.createPlatformInvoice).not.toHaveBeenCalled();
  });

  it('correo válido → delega en el servicio', async () => {
    const body = dto({ email: 'compras@andina.co' });
    await controller.createPlatformInvoice(body);
    expect(fiscalService.createPlatformInvoice).toHaveBeenCalledWith(body);
  });

  it('consumidor final 222222222222 → exento', async () => {
    await controller.createPlatformInvoice(
      dto({ tax_id: '222222222222', document_type: '13' }),
    );
    expect(fiscalService.createPlatformInvoice).toHaveBeenCalledTimes(1);
  });
});
