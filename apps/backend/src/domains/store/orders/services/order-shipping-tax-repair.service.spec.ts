import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { RepairShippingTaxDto } from '../dto/repair-shipping-tax.dto';
import { OrderShippingTaxRepairService } from './order-shipping-tax-repair.service';
import { OrdersController } from '../orders.controller';

/** Orden despachada con copia incoherente (tarifa ausente, `missing_rate`). */
function deliveredOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 1044,
    store_id: 3,
    state: 'delivered',
    shipping_cost: 15000,
    grand_total: 115000,
    shipping_tax_rate_id: 70,
    shipping_tax_name: 'INC 8%',
    shipping_tax_type: 'inc',
    shipping_tax_rate: null,
    shipping_tax_amount: 1111.11,
    ...overrides,
  };
}

const inc8Rate = {
  id: 70,
  name: 'INC 8%',
  rate: 0.08,
  tax_categories: { tax_type: 'inc' },
};

describe('OrderShippingTaxRepairService', () => {
  let prisma: any;
  let base: any;
  let auditService: any;
  let service: OrderShippingTaxRepairService;

  beforeEach(() => {
    prisma = {
      orders: { findFirst: jest.fn(), updateMany: jest.fn() },
      invoices: { findFirst: jest.fn(), findMany: jest.fn() },
      accounting_entries: { findFirst: jest.fn() },
    };
    base = { tax_rates: { findFirst: jest.fn() } };
    prisma.withoutScope = jest.fn(() => base);
    auditService = { logCustom: jest.fn().mockResolvedValue(undefined) };
    service = new OrderShippingTaxRepairService(prisma, auditService);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9, store_id: 3 } as any);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    prisma.invoices.findFirst.mockResolvedValue(null);
    prisma.invoices.findMany.mockResolvedValue([]);
    prisma.accounting_entries.findFirst.mockResolvedValue(null);
    prisma.orders.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => jest.restoreAllMocks());

  describe('complete_rate', () => {
    it('rellena name/type/rate desde la tarifa conservando el amount (nunca toca totales)', async () => {
      prisma.orders.findFirst.mockResolvedValue(deliveredOrder());
      base.tax_rates.findFirst.mockResolvedValue(inc8Rate);

      const result = await service.repair(1044, {
        action: 'complete_rate',
        reason: 'copia incompleta',
      } as RepairShippingTaxDto);

      expect(prisma.orders.updateMany).toHaveBeenCalledWith({
        where: { id: 1044, store_id: 3 },
        data: {
          shipping_tax_name: 'INC 8%',
          shipping_tax_type: 'inc',
          shipping_tax_rate: 0.08,
        },
      });
      const data = prisma.orders.updateMany.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('shipping_cost');
      expect(data).not.toHaveProperty('grand_total');
      expect(data).not.toHaveProperty('shipping_tax_amount');
      expect(result).toEqual({
        order_id: 1044,
        action: 'complete_rate',
        shipping_tax: {
          shipping_tax_rate_id: 70,
          shipping_tax_name: 'INC 8%',
          shipping_tax_type: 'inc',
          shipping_tax_rate: 0.08,
          shipping_tax_amount: 1111.11,
        },
        shipping_cost: 15000,
        grand_total: 115000,
      });
      expect(auditService.logCustom).toHaveBeenCalledWith(
        9,
        'order.shipping_tax.repaired',
        'orders',
        expect.objectContaining({
          order_id: 1044,
          store_id: 3,
          action: 'complete_rate',
          reason: 'copia incompleta',
        }),
        1044,
      );
      // La tarifa se lee con filtro explícito de tenant (tienda o global).
      expect(base.tax_rates.findFirst.mock.calls[0][0].where).toEqual({
        id: 70,
        OR: [{ store_id: 3 }, { store_id: null }],
      });
    });

    it('sin shipping_tax_rate_id ⇒ 409 (nada desde dónde completar)', async () => {
      prisma.orders.findFirst.mockResolvedValue(
        deliveredOrder({ shipping_tax_rate_id: null }),
      );

      await expect(
        service.repair(1044, {
          action: 'complete_rate',
          reason: 'copia incompleta',
        } as RepairShippingTaxDto),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          error_code: 'ORD_SHIPPING_TAX_REPAIR_BLOCKED_001',
        }),
      });
      expect(prisma.orders.updateMany).not.toHaveBeenCalled();
      expect(auditService.logCustom).not.toHaveBeenCalled();
    });

    it('tarifa inexistente en la tienda ⇒ 409', async () => {
      prisma.orders.findFirst.mockResolvedValue(deliveredOrder());
      base.tax_rates.findFirst.mockResolvedValue(null);

      await expect(
        service.repair(1044, {
          action: 'complete_rate',
          reason: 'copia incompleta',
        } as RepairShippingTaxDto),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          error_code: 'ORD_SHIPPING_TAX_REPAIR_BLOCKED_001',
        }),
      });
      expect(prisma.orders.updateMany).not.toHaveBeenCalled();
    });

    it('categoría fuera de iva/inc ⇒ 409 (completar sería éxito falso)', async () => {
      prisma.orders.findFirst.mockResolvedValue(deliveredOrder());
      base.tax_rates.findFirst.mockResolvedValue({
        ...inc8Rate,
        tax_categories: { tax_type: 'ica' },
      });

      await expect(
        service.repair(1044, {
          action: 'complete_rate',
          reason: 'copia incompleta',
        } as RepairShippingTaxDto),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          error_code: 'ORD_SHIPPING_TAX_REPAIR_BLOCKED_001',
        }),
      });
      expect(prisma.orders.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('sin facturas ⇒ copia vacía OK', async () => {
      prisma.orders.findFirst.mockResolvedValue(deliveredOrder());

      const result = await service.repair(1044, {
        action: 'clear',
        reason: 'impuesto no aplica',
      } as RepairShippingTaxDto);

      expect(prisma.orders.updateMany).toHaveBeenCalledWith({
        where: { id: 1044, store_id: 3 },
        data: {
          shipping_tax_rate_id: null,
          shipping_tax_name: null,
          shipping_tax_type: null,
          shipping_tax_rate: null,
          shipping_tax_amount: 0,
        },
      });
      expect(result.shipping_tax).toEqual({
        shipping_tax_rate_id: null,
        shipping_tax_name: null,
        shipping_tax_type: null,
        shipping_tax_rate: null,
        shipping_tax_amount: 0,
      });
      expect(result.shipping_cost).toBe(15000);
      expect(result.grand_total).toBe(115000);
      expect(auditService.logCustom).toHaveBeenCalled();
    });

    it('con borrador sin asiento ⇒ copia vacía OK', async () => {
      prisma.orders.findFirst.mockResolvedValue(deliveredOrder());
      prisma.invoices.findMany.mockResolvedValue([{ id: 5 }]);
      prisma.accounting_entries.findFirst.mockResolvedValue(null);

      await service.repair(1044, {
        action: 'clear',
        reason: 'impuesto no aplica',
      } as RepairShippingTaxDto);

      expect(prisma.accounting_entries.findFirst).toHaveBeenCalledWith({
        where: {
          source_type: 'invoice.validated',
          source_id: { in: [5] },
          status: 'posted',
        },
        select: { id: true, entry_number: true },
      });
      expect(prisma.orders.updateMany).toHaveBeenCalled();
    });

    it('con asiento de venta contabilizado ⇒ 409 (sin mutar ni auditar)', async () => {
      prisma.orders.findFirst.mockResolvedValue(deliveredOrder());
      prisma.invoices.findMany.mockResolvedValue([{ id: 5 }]);
      prisma.accounting_entries.findFirst.mockResolvedValue({
        id: 9,
        entry_number: 'AE-2026-000123',
      });

      await expect(
        service.repair(1044, {
          action: 'clear',
          reason: 'impuesto no aplica',
        } as RepairShippingTaxDto),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          error_code: 'ORD_SHIPPING_TAX_REPAIR_BLOCKED_001',
        }),
      });
      expect(prisma.orders.updateMany).not.toHaveBeenCalled();
      expect(auditService.logCustom).not.toHaveBeenCalled();
    });
  });

  describe('guardas comunes', () => {
    it.each(['validated', 'sent', 'accepted'])(
      'con factura %s ⇒ 409 INVOICING_CREATE_002',
      async (status) => {
        prisma.orders.findFirst.mockResolvedValue(deliveredOrder());
        prisma.invoices.findFirst.mockResolvedValue({
          id: 5,
          invoice_number: 'SETP990000001',
          status,
        });

        await expect(
          service.repair(1044, {
            action: 'complete_rate',
            reason: 'copia incompleta',
          } as RepairShippingTaxDto),
        ).rejects.toMatchObject({
          status: 409,
          response: expect.objectContaining({
            error_code: 'INVOICING_CREATE_002',
          }),
        });
        expect(prisma.orders.updateMany).not.toHaveBeenCalled();
      },
    );

    it('el borrador NO bloquea (solo factura vigente no borrador)', async () => {
      prisma.orders.findFirst.mockResolvedValue(deliveredOrder());
      // La guarda filtra por validated/sent/accepted: el mock por defecto
      // (null = sin factura vigente) deja pasar aunque exista borrador.
      base.tax_rates.findFirst.mockResolvedValue(inc8Rate);

      await service.repair(1044, {
        action: 'complete_rate',
        reason: 'copia incompleta',
      } as RepairShippingTaxDto);

      expect(
        prisma.invoices.findFirst.mock.calls[0][0].where.status,
      ).toEqual({ in: ['validated', 'sent', 'accepted'] });
      expect(prisma.orders.updateMany).toHaveBeenCalled();
    });

    it.each(['cancelled', 'refunded'])(
      'orden %s ⇒ 409 (no reparable)',
      async (state) => {
        prisma.orders.findFirst.mockResolvedValue(deliveredOrder({ state }));

        await expect(
          service.repair(1044, {
            action: 'clear',
            reason: 'impuesto no aplica',
          } as RepairShippingTaxDto),
        ).rejects.toMatchObject({
          status: 409,
          response: expect.objectContaining({
            error_code: 'ORD_SHIPPING_TAX_REPAIR_BLOCKED_001',
          }),
        });
        expect(prisma.orders.updateMany).not.toHaveBeenCalled();
      },
    );

    it('orden inexistente ⇒ 404', async () => {
      prisma.orders.findFirst.mockResolvedValue(null);

      await expect(
        service.repair(9999, {
          action: 'clear',
          reason: 'impuesto no aplica',
        } as RepairShippingTaxDto),
      ).rejects.toMatchObject({
        status: 404,
        response: expect.objectContaining({ error_code: 'ORD_FIND_001' }),
      });
    });

    it('carrera perdida en el update (count 0) ⇒ 404, sin éxito falso', async () => {
      prisma.orders.findFirst.mockResolvedValue(deliveredOrder());
      base.tax_rates.findFirst.mockResolvedValue(inc8Rate);
      prisma.orders.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.repair(1044, {
          action: 'complete_rate',
          reason: 'copia incompleta',
        } as RepairShippingTaxDto),
      ).rejects.toMatchObject({
        status: 404,
        response: expect.objectContaining({ error_code: 'ORD_FIND_001' }),
      });
      expect(auditService.logCustom).not.toHaveBeenCalled();
    });
  });
});

describe('RepairShippingTaxDto (contrato de validación global)', () => {
  const validate = (input: Record<string, unknown>) =>
    validateSync(plainToInstance(RepairShippingTaxDto, input), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('acepta {action, reason} válido', () => {
    expect(
      validate({ action: 'complete_rate', reason: 'copia incompleta' }),
    ).toHaveLength(0);
    expect(validate({ action: 'clear', reason: 'impuesto no aplica' })).toHaveLength(0);
  });

  it('rechaza acción fuera del enum, motivo corto y campos extra', () => {
    expect(
      validate({ action: 'rebuild', reason: 'copia incompleta' }).length,
    ).toBeGreaterThan(0);
    expect(validate({ action: 'clear', reason: 'ab' }).length).toBeGreaterThan(0);
    expect(validate({ action: 'clear' }).length).toBeGreaterThan(0);
    expect(
      validate({ action: 'clear', reason: 'motivo válido', shipping_cost: 1 })
        .length,
    ).toBeGreaterThan(0);
  });
});

describe('POST /store/orders/:id/shipping-tax/repair (ruta)', () => {
  const handler = OrdersController.prototype.repairShippingTax;

  it('es POST :id/shipping-tax/repair con permiso store:orders:update', () => {
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      ':id/shipping-tax/repair',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
    );
    // Un token sin este permiso lo niega PermissionsGuard con 403.
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      'store:orders:update',
    ]);
  });

  it('el controlador vive bajo PermissionsGuard', () => {
    const guards: unknown[] =
      Reflect.getMetadata('__guards__', OrdersController) ?? [];
    expect(guards).toContain(PermissionsGuard);
  });

  it('delega sin try/catch: el error tipado del servicio se propaga', async () => {
    const repair = jest.fn();
    const updated = jest
      .fn()
      .mockImplementation((data: unknown, message: string) => ({
        data,
        message,
      }));
    const controller = Object.create(OrdersController.prototype) as Record<
      string,
      unknown
    >;
    controller.shippingTaxRepairService = { repair };
    controller.responseService = { updated };
    const dto = plainToInstance(RepairShippingTaxDto, {
      action: 'complete_rate',
      reason: 'copia incompleta',
    });

    repair.mockResolvedValue({ order_id: 1044 });
    await (controller.repairShippingTax as (id: number, dto: unknown) => unknown)(
      1044,
      dto,
    );
    expect(repair).toHaveBeenCalledWith(1044, dto);
    expect(updated).toHaveBeenCalledWith(
      { order_id: 1044 },
      expect.any(String),
    );

    const typed = new Error('typed');
    repair.mockRejectedValue(typed);
    await expect(
      (controller.repairShippingTax as (id: number, dto: unknown) => unknown)(
        1044,
        dto,
      ),
    ).rejects.toBe(typed);
  });
});
