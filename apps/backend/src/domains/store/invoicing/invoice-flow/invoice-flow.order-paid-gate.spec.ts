import { Prisma } from '@prisma/client';
import { InvoiceFlowService } from './invoice-flow.service';

/**
 * Puerta de pago de la emisión: una factura de VENTA con `order_id` no se emite
 * (validate/send) mientras la orden deba saldo, salvo venta a crédito. Prueba
 * el guard privado sin levantar Nest (instancia vía prototipo + prisma mock).
 */
describe('invoice-flow · puerta de orden pagada (INVOICING_ORDER_UNPAID_001)', () => {
  const dec = (v: string) => new Prisma.Decimal(v);

  const build = (order: unknown) => {
    const service = Object.create(InvoiceFlowService.prototype) as any;
    service.prisma = { orders: { findFirst: jest.fn().mockResolvedValue(order) } };
    return service as {
      assertOrderPaidForEmission: (i: any) => Promise<void>;
      prisma: { orders: { findFirst: jest.Mock } };
    };
  };

  const invoice = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    order_id: 9117,
    invoice_type: 'sales_invoice',
    ...overrides,
  });

  it('orden sin pagos y saldo abierto → 409 INVOICING_ORDER_UNPAID_001', async () => {
    const service = build({ grand_total: dec('66000'), payment_form: '1', payments: [] });

    const error: any = await service.assertOrderPaidForEmission(invoice()).catch((e) => e);

    expect(error.errorCode).toBe('INVOICING_ORDER_UNPAID_001');
    expect(error.getStatus()).toBe(409);
  });

  it('pago parcial succeeded + uno pending → sigue bloqueando', async () => {
    const service = build({
      grand_total: dec('66000'),
      payment_form: '1',
      payments: [
        { state: 'succeeded', amount: dec('1000') },
        { state: 'pending', amount: dec('65000') },
      ],
    });

    const error: any = await service.assertOrderPaidForEmission(invoice()).catch((e) => e);

    expect(error.errorCode).toBe('INVOICING_ORDER_UNPAID_001');
  });

  it('orden saldada (succeeded + captured = total) → pasa', async () => {
    const service = build({
      grand_total: dec('66000'),
      payment_form: '1',
      payments: [
        { state: 'succeeded', amount: dec('60000') },
        { state: 'captured', amount: dec('6000') },
      ],
    });

    await expect(service.assertOrderPaidForEmission(invoice())).resolves.toBeUndefined();
  });

  it('venta a crédito (payment_form 2) sin pagos → pasa', async () => {
    const service = build({ grand_total: dec('66000'), payment_form: '2', payments: [] });

    await expect(service.assertOrderPaidForEmission(invoice())).resolves.toBeUndefined();
  });

  it('factura sin orden (manual) → no consulta ni bloquea', async () => {
    const service = build(null);

    await expect(
      service.assertOrderPaidForEmission(invoice({ order_id: null })),
    ).resolves.toBeUndefined();
    expect(service.prisma.orders.findFirst).not.toHaveBeenCalled();
  });

  it('nota crédito con order_id → no se juzga el pago', async () => {
    const service = build({ grand_total: dec('66000'), payment_form: '1', payments: [] });

    await expect(
      service.assertOrderPaidForEmission(invoice({ invoice_type: 'credit_note' })),
    ).resolves.toBeUndefined();
    expect(service.prisma.orders.findFirst).not.toHaveBeenCalled();
  });
});
