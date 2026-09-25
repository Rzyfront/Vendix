import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from './orders.service';
import { ErrorCodes } from 'src/common/errors';

/**
 * BE-2 pasos 2+6 — contrato de titular de órdenes.
 *
 * - findAll/findOne proyectan users{legal_name, document_type,
 *   document_number, person_type} y el OR de búsqueda matchea legal_name y
 *   phone case-insensitive con scope tenant.
 * - PATCH /store/orders/:id con cambio de titular permite
 *   created/draft/pending_payment/processing/pending_delivery
 *   (409 ORD_EDIT_NOT_ALLOWED_001 en shipped/delivered/finished/
 *   cancelled/refunded) y exige cliente del store
 *   (403 ORD_EDIT_CUSTOMER_STORE_MISMATCH_001).
 */
describe('OrdersService — contrato titular (BE-2)', () => {
  const prisma: any = {
    orders: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    store_users: { findFirst: jest.fn() },
  };
  const orderFlow = { forceOrderState: jest.fn(), cancelOrder: jest.fn() };

  const service = new OrdersService(
    prisma,
    { signUrl: jest.fn(async (u: string) => u) } as any,
    { emit: jest.fn() } as unknown as EventEmitter2,
    {} as any,
    { validateOrThrow: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    orderFlow as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const draftOrder = {
    id: 924,
    store_id: 1,
    order_number: 'D-1',
    state: 'draft',
    customer_id: 12,
    customer_alias: null,
    active_financial_split_id: null,
    subtotal_amount: '1000.00',
    tax_amount: '0.00',
    discount_amount: '0.00',
    tip_amount: '0.00',
    order_items: [],
    payments: [],
    users: { id: 12, first_name: 'Miguel', last_name: 'P' },
  };

  describe('PATCH titular — gate de estado', () => {
    it.each(['shipped', 'delivered', 'finished', 'cancelled', 'refunded'])(
      'rechaza cambio de titular en estado=%s con 409 ORD_EDIT_NOT_ALLOWED_001',
      async (state) => {
        prisma.orders.findFirst.mockResolvedValue({ ...draftOrder, state });
        await expect(
          service.update(924, { customer_id: 217 } as any),
        ).rejects.toMatchObject({
          errorCode: ErrorCodes.ORD_EDIT_NOT_ALLOWED_001.code,
        });
        expect(prisma.orders.update).not.toHaveBeenCalled();
      },
    );

    it.each([
      'created',
      'draft',
      'pending_payment',
      'processing',
      'pending_delivery',
    ])(
      'permite cambio de titular en estado=%s cuando el cliente es del store (200)',
      async (state) => {
        prisma.orders.findFirst.mockResolvedValue({ ...draftOrder, state });
        prisma.store_users.findFirst.mockResolvedValue({ id: 7 });
        prisma.orders.update.mockResolvedValue({
          ...draftOrder,
          state,
          customer_id: 217,
        });
        const result = await service.update(924, { customer_id: 217 } as any);
        expect(result.customer_id).toBe(217);
        expect(prisma.orders.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 924 },
            data: expect.objectContaining({ customer_id: 217 }),
          }),
        );
      },
    );

    it('rechaza cambio de customer_alias en finished con el mismo 409', async () => {
      prisma.orders.findFirst.mockResolvedValue({
        ...draftOrder,
        state: 'finished',
      });
      await expect(
        service.update(924, { customer_alias: 'Mesa 5' } as any),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.ORD_EDIT_NOT_ALLOWED_001.code,
      });
      expect(prisma.orders.update).not.toHaveBeenCalled();
    });

    it('permite metadata sin titular en finished (el gate solo cubre titular)', async () => {
      prisma.orders.findFirst.mockResolvedValue({
        ...draftOrder,
        state: 'finished',
      });
      prisma.orders.update.mockResolvedValue({ ...draftOrder, state: 'finished' });
      await service.update(924, { internal_notes: 'nota' } as any);
      expect(prisma.orders.update).toHaveBeenCalled();
    });
  });

  describe('PATCH titular — pertenencia al store', () => {
    it('rechaza customer_id de otra tienda con 403 en draft', async () => {
      prisma.orders.findFirst.mockResolvedValue({ ...draftOrder });
      prisma.store_users.findFirst.mockResolvedValue(null);
      await expect(
        service.update(924, { customer_id: 194 } as any),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.ORD_EDIT_CUSTOMER_STORE_MISMATCH_001.code,
      });
      expect(prisma.store_users.findFirst).toHaveBeenCalledWith({
        where: { store_id: 1, user_id: 194 },
        select: { id: true },
      });
      expect(prisma.orders.update).not.toHaveBeenCalled();
    });

    it('aplica cambio de titular en draft cuando el cliente es del store (200)', async () => {
      prisma.orders.findFirst.mockResolvedValue({ ...draftOrder });
      prisma.store_users.findFirst.mockResolvedValue({ id: 7 });
      prisma.orders.update.mockResolvedValue({ ...draftOrder, customer_id: 217 });
      const result = await service.update(924, { customer_id: 217 } as any);
      expect(result.customer_id).toBe(217);
      expect(prisma.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 924 },
          data: expect.objectContaining({ customer_id: 217 }),
        }),
      );
    });
  });

  describe('findAll — búsqueda y proyección de titular', () => {
    it('el OR de búsqueda incluye legal_name y phone case-insensitive', async () => {
      prisma.orders.findMany.mockResolvedValue([]);
      prisma.orders.count.mockResolvedValue(0);
      await service.findAll({ search: 'Cascada', page: 1, limit: 10 } as any);
      const where = prisma.orders.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { users: { legal_name: { contains: 'Cascada', mode: 'insensitive' } } },
          { users: { phone: { contains: 'Cascada', mode: 'insensitive' } } },
        ]),
      );
    });

    it('proyecta users con identidad fiscal en el listado', async () => {
      prisma.orders.findMany.mockResolvedValue([]);
      prisma.orders.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 10 } as any);
      const include = prisma.orders.findMany.mock.calls[0][0].include;
      expect(include.users.select).toEqual(
        expect.objectContaining({
          legal_name: true,
          document_type: true,
          document_number: true,
          person_type: true,
        }),
      );
    });

    it('proyecta users con identidad fiscal en el detalle', async () => {
      prisma.orders.findFirst.mockResolvedValue({ ...draftOrder });
      await service.findOne(924);
      const include = prisma.orders.findFirst.mock.calls[0][0].include;
      expect(include.users.select).toEqual(
        expect.objectContaining({
          legal_name: true,
          document_type: true,
          document_number: true,
          person_type: true,
          phone: true,
        }),
      );
    });
  });
});
