import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from './orders.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Orden facturada → congelada. Con un documento de venta vigente
 * (`validated|sent|accepted|rejected`) las líneas, precios, descuentos y envío
 * no se editan: 409 `ORD_INVOICED_LOCKED_001`. Borradores y anuladas no
 * bloquean; el titular conserva su guarda propia (`ORD_TITULAR_INVOICED_001`).
 */
describe('OrdersService — bloqueo por factura (ORD_INVOICED_LOCKED_001)', () => {
  const prisma: any = {
    orders: { findFirst: jest.fn(), update: jest.fn() },
    store_users: { findFirst: jest.fn() },
    invoices: { findFirst: jest.fn() },
    accounts_receivable: { findFirst: jest.fn() },
    shipping_methods: { findFirst: jest.fn() },
    table_sessions: { findFirst: jest.fn() },
  };
  const service: any = new OrdersService(
    prisma,
    { signUrl: jest.fn(async (u: string) => u) } as any,
    { emit: jest.fn() } as unknown as EventEmitter2,
    {} as any,
    { validateOrThrow: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    { forceOrderState: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { update: jest.fn() } as any,
  );

  const order = (state = 'created') => ({
    id: 5,
    store_id: 1,
    state,
    customer_id: 12,
    active_financial_split_id: null,
    subtotal_amount: '1000.00',
    tax_amount: '0.00',
    discount_amount: '0.00',
    tip_amount: '0.00',
    shipping_cost: '0.00',
    shipping_method_id: null,
    shipping_rate_id: null,
  });
  const locked = (status = 'accepted') => ({ id: 77, status });
  const lockedError = {
    response: expect.objectContaining({ error_code: 'ORD_INVOICED_LOCKED_001' }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 1,
      organization_id: 1,
      user_id: 9,
    } as any);
    prisma.invoices.findFirst.mockResolvedValue(null);
    prisma.table_sessions.findFirst.mockResolvedValue(null);
    prisma.orders.findFirst.mockResolvedValue(order());
    jest.spyOn(service, 'findOne').mockResolvedValue(order());
  });

  it('la consulta solo cuenta documentos de venta vigentes del titular (no borrador/anulada/cuenta)', async () => {
    prisma.invoices.findFirst.mockResolvedValue(locked('validated'));
    await expect(
      service.updateOrderItems(5, { items: [] } as any),
    ).rejects.toMatchObject(lockedError);
    expect(prisma.invoices.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          order_id: 5,
          invoice_type: {
            in: ['sales_invoice', 'export_invoice', 'pos_equivalent_document'],
          },
          status: { in: ['validated', 'sent', 'accepted', 'rejected'] },
          financial_account_id: null,
        },
      }),
    );
  });

  describe.each(['validated', 'sent', 'accepted', 'rejected'])(
    'factura %s',
    (status) => {
      beforeEach(() =>
        prisma.invoices.findFirst.mockResolvedValue(locked(status)),
      );

      it('updateOrderItems → ORD_INVOICED_LOCKED_001 con el detalle de la factura', async () => {
        await expect(
          service.updateOrderItems(5, { items: [] } as any),
        ).rejects.toMatchObject({
          response: expect.objectContaining({
            error_code: 'ORD_INVOICED_LOCKED_001',
            message:
              'Esta orden ya tiene factura electrónica. Para corregirla emite una nota crédito.',
            details: { invoice_id: 77, invoice_status: status },
          }),
        });
      });

      it('updateOrderFromEditor → ORD_INVOICED_LOCKED_001', async () => {
        await expect(
          service.updateOrderFromEditor(5, { items: [] } as any),
        ).rejects.toMatchObject(lockedError);
      });

      it('assignShipping con costo nuevo → ORD_INVOICED_LOCKED_001', async () => {
        prisma.shipping_methods.findFirst.mockResolvedValue({ id: 4, type: 'custom' });
        await expect(
          service.assignShipping(5, { shipping_method_id: 4, shipping_cost: 500 } as any),
        ).rejects.toMatchObject(lockedError);
      });

      it('assignShipping al MISMO costo no consulta el bloqueo (reasignar método sigue permitido)', async () => {
        prisma.shipping_methods.findFirst.mockResolvedValue({ id: 4, type: 'custom' });
        const lockSpy = jest.spyOn(service, 'assertOrderNotInvoiceLocked');
        await service
          .assignShipping(5, { shipping_method_id: 4, shipping_cost: 0 } as any)
          .catch(() => undefined);
        expect(lockSpy).not.toHaveBeenCalled();
      });

      it('update cambiando sólo el método al mismo costo no bloquea', async () => {
        const lockSpy = jest.spyOn(service, 'assertOrderNotInvoiceLocked');
        await service
          .update(5, { shipping_method_id: 9 } as any)
          .catch(() => undefined);
        expect(lockSpy).not.toHaveBeenCalled();
      });

      it.each([
        { discount_amount: 5 },
        { subtotal: 10 },
        { items: [] },
        { shipping_cost: 500 },
      ])('update %j (campo económico) → ORD_INVOICED_LOCKED_001', async (dto) => {
        await expect(service.update(5, dto as any)).rejects.toMatchObject(
          lockedError,
        );
        expect(prisma.orders.update).not.toHaveBeenCalled();
      });
    },
  );

  it('update de titular con factura aceptada sigue siendo ORD_TITULAR_INVOICED_001 (guarda intacta)', async () => {
    prisma.store_users.findFirst.mockResolvedValue({ id: 1 });
    prisma.accounts_receivable.findFirst.mockResolvedValue(null);
    prisma.invoices.findFirst.mockResolvedValue({
      id: 77,
      status: 'accepted',
      customer_id: 12,
    });
    await expect(
      service.update(5, { customer_id: 99 } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'ORD_TITULAR_INVOICED_001' }),
    });
  });

  it('update de solo alias con factura aceptada no se bloquea', async () => {
    prisma.invoices.findFirst.mockResolvedValue(locked('accepted'));
    prisma.orders.update.mockResolvedValue({ ...order(), customer_alias: 'x' });
    await service.update(5, { customer_alias: 'x' } as any);
    expect(prisma.orders.update).toHaveBeenCalled();
  });

  describe('sin factura vigente el comportamiento previo se mantiene', () => {
    it('updateOrderItems en estado shipped sigue siendo ORD_STATUS_001', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(order('shipped'));
      await expect(
        service.updateOrderItems(5, { items: [] } as any),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'ORD_STATUS_001' }),
      });
    });

    it('updateOrderFromEditor en estado shipped sigue siendo ORD_EDIT_NOT_ALLOWED_001', async () => {
      prisma.orders.findFirst.mockResolvedValue(order('shipped'));
      await expect(
        service.updateOrderFromEditor(5, { items: [] } as any),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'ORD_EDIT_NOT_ALLOWED_001',
        }),
      });
    });

    it('assignShipping con método inexistente sigue siendo ORD_SHIP_INVALID_METHOD_001', async () => {
      prisma.shipping_methods.findFirst.mockResolvedValue(null);
      await expect(
        service.assignShipping(5, { shipping_method_id: 4 } as any),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'ORD_SHIP_INVALID_METHOD_001',
        }),
      });
    });
  });
});
