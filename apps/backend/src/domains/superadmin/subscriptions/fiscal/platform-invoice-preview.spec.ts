import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubscriptionFiscalService } from './subscription-fiscal.service';
import { PlatformInvoicingService } from './platform-invoicing.service';
import { PlatformInvoicingController } from './platform-invoicing.controller';
import { PreviewPlatformSalesInvoiceDto } from './dto/platform-invoice-preview.dto';
import { CustomerFiscalIdentityValidator } from '../../../store/invoicing/validators/customer-fiscal-identity.validator';
import { FiscalDocumentValidator } from '../../../store/invoicing/validators/fiscal-document.validator';
import { VendixHttpException } from '../../../../common/errors';

/** Prisma que explota ante CUALQUIER acceso: la preview no toca la BD. */
const forbiddenPrisma: any = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(`prisma.${String(prop)} no debe tocarse en la preview`);
    },
  },
);

function makeFiscal() {
  const unused = {};
  return Reflect.construct(SubscriptionFiscalService, [
    forbiddenPrisma,
    unused, unused, unused, unused, unused, unused, unused, unused, unused,
    unused, unused,
    { reveal: () => 'a'.repeat(64) },
    new CustomerFiscalIdentityValidator(),
    new FiscalDocumentValidator(),
    unused, unused,
  ]) as SubscriptionFiscalService;
}

const dto = (items: any[], extra: any = {}) => ({
  operation_type: '10',
  items,
  ...extra,
});
const iva = { tax_type: 'IVA', rate: 0.19 };

describe('Previsualización de factura de plataforma', () => {
  const fiscal = makeFiscal();
  const facade = Object.create(PlatformInvoicingService.prototype) as any;
  facade.subscriptionFiscalService = fiscal;
  facade.prismaService = forbiddenPrisma;
  facade.invoicingService = new Proxy({}, { get() { throw new Error('DIAN no debe llamarse'); } });

  const items = [
    { description: 'Plan', quantity: 3, unit_price: 10005, taxes: [iva] },
    { description: 'Setup', quantity: 1, unit_price: 50000, discount_amount: 5000, taxes: [] },
  ];

  it('devuelve los mismos totales que computePlatformInvoiceTotals', () => {
    const computed = fiscal.computePlatformInvoiceTotals({ items } as any);
    const r = facade.previewSalesInvoice(dto(items));
    expect(r.subtotal).toBe(computed.subtotal);
    expect(r.tax_total).toBe(computed.taxTotal);
    expect(r.discount_total).toBe(computed.discountTotal);
    expect(r.total).toBe(computed.payable);
    expect(r.payable).toBe(computed.payable);
    expect(r.tax_breakdown).toEqual(computed.taxBreakdown);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].tax_amount).toBe(computed.lineItems[0].tax_amount);
    expect(r.lines[0].total).toBe(computed.lineItems[0].total_amount);
  });

  it('suma retenciones sin tocar el total DIAN', () => {
    const r = facade.previewSalesInvoice(
      dto(items, {
        withholdings: [{ role: 'withholdee', concept_id: 1, base_amount: 1000, rate: 0.04 }],
      }),
    );
    expect(r.withholdings_total).toBe('40.00');
    expect(Number(r.net_after_withholdings)).toBeCloseTo(Number(r.total) - 40, 2);
  });

  it('input inválido de cálculo lanza 400 (VendixHttpException), no 500', () => {
    try {
      facade.previewSalesInvoice(
        dto([{ description: 'x', quantity: 1, unit_price: 100, discount_amount: 500 }]),
      );
      fail('debía lanzar');
    } catch (e: any) {
      expect(e).toBeInstanceOf(VendixHttpException);
      expect(e.getStatus()).toBe(400);
    }
  });

  it('el DTO exige items pero no cliente ni idempotencia', async () => {
    const ok = plainToInstance(PreviewPlatformSalesInvoiceDto, {
      operation_type: '10',
      items: [{ description: 'a', quantity: 1, unit_price: 10 }],
    });
    expect(await validate(ok)).toHaveLength(0);
    const bad = plainToInstance(PreviewPlatformSalesInvoiceDto, { operation_type: '10', items: [] });
    expect((await validate(bad)).length).toBeGreaterThan(0);
  });
});

describe('Mensajes del controller según estado de la transmisión', () => {
  const response = {
    created: jest.fn((d: any, m: string) => ({ d, m })),
    success: jest.fn((d: any, m: string) => ({ d, m })),
  };
  const platformInvoicing: any = {
    createSalesInvoice: jest.fn(),
    sendInvoice: jest.fn(),
  };
  const subFiscal: any = {
    getSettingsForController: jest.fn().mockResolvedValue({
      platform_organization_id: 1,
      accounting_entity_id: 2,
      dian_configuration_id: 3,
    }),
  };
  const controller = new PlatformInvoicingController(
    response as any,
    platformInvoicing,
    {} as any,
    subFiscal,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  it('creación aceptada', async () => {
    platformInvoicing.createSalesInvoice.mockResolvedValue({ accepted: true, transmission_status: 'accepted' });
    const r: any = await controller.createSalesInvoice({} as any);
    expect(r.m).toBe('Factura emitida y aceptada por la DIAN');
  });

  it('creación rechazada no dice exitosa', async () => {
    platformInvoicing.createSalesInvoice.mockResolvedValue({
      accepted: false,
      transmission_status: 'rejected',
      error_message: 'FAD06 NIT inválido',
    });
    const r: any = await controller.createSalesInvoice({} as any);
    expect(r.m).toBe('Factura creada pero la DIAN no la aceptó: FAD06 NIT inválido');
    expect(r.m.toLowerCase()).not.toContain('exitosa');
  });

  it('send aceptada / rechazada', async () => {
    platformInvoicing.sendInvoice.mockResolvedValueOnce({ accepted: true, transmission_status: 'accepted' });
    expect(((await controller.sendInvoice(1)) as any).m).toBe('Factura emitida y aceptada por la DIAN');
    platformInvoicing.sendInvoice.mockResolvedValueOnce({
      accepted: false,
      transmission_status: 'error',
      error_message: 'timeout',
    });
    expect(((await controller.sendInvoice(1)) as any).m).toBe(
      'Factura creada pero la DIAN no la aceptó: timeout',
    );
  });
});
