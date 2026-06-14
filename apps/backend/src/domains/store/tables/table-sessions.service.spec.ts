import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { TableSessionsService } from './table-sessions.service';
import { TablesService } from './tables.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

describe('TableSessionsService — open + addItems (Fase E smoke)', () => {
  let service: TableSessionsService;
  let tablesService: TablesService;
  let prismaMock: any;
  let context: any;

  const STORE_ID = 100;
  const USER_ID = 42;

  beforeEach(() => {
    context = {
      store_id: STORE_ID,
      organization_id: 1,
      user_id: USER_ID,
      is_super_admin: false,
    };

    prismaMock = {
      tables: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      table_sessions: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      orders: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
      },
      order_items: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      products: {
        findMany: jest.fn(),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({ currency: 'COP' }),
      },
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
    };

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(context);

    tablesService = {
      getById: jest.fn(),
      getActiveSession: jest.fn(),
    } as any;

    service = new TableSessionsService(
      prismaMock as any,
      tablesService as any,
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('openSession', () => {
    it('creates a draft order + table_session, flips table to occupied', async () => {
      (tablesService.getById as jest.Mock).mockResolvedValue({
        id: 5,
        store_id: STORE_ID,
        name: 'Mesa 5',
        zone: null,
        capacity: 4,
        status: 'available',
        pos_x: null,
        pos_y: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      (tablesService.getActiveSession as jest.Mock).mockResolvedValue(
        null,
      );

      prismaMock.orders.create.mockResolvedValue({
        id: 9001,
        order_number: 'T-1234-001',
      });
      prismaMock.table_sessions.create.mockResolvedValue({
        id: 77,
        order_id: 9001,
        table_id: 5,
        opened_by: USER_ID,
        opened_at: new Date(),
        closed_at: null,
        guest_count: 4,
      });
      prismaMock.tables.update.mockResolvedValue({});

      prismaMock.table_sessions.findFirst.mockResolvedValue({
        id: 77,
        store_id: STORE_ID,
        table_id: 5,
        order_id: 9001,
        opened_by: USER_ID,
        opened_at: new Date(),
        closed_at: null,
        guest_count: 4,
        order: {
          id: 9001,
          state: 'draft',
          grand_total: new Prisma.Decimal(0),
          subtotal_amount: new Prisma.Decimal(0),
          tax_amount: new Prisma.Decimal(0),
          discount_amount: new Prisma.Decimal(0),
          order_items: [],
        },
        table: {
          id: 5,
          name: 'Mesa 5',
          zone: null,
          status: 'occupied',
        },
      });

      const result = await service.openSession({
        table_id: 5,
        guest_count: 4,
      } as any);

      expect(result.id).toBe(77);
      expect(prismaMock.orders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            state: 'draft',
            store_id: STORE_ID,
          }),
        }),
      );
      expect(prismaMock.tables.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'occupied' }),
        }),
      );
    });

    it('rejects when the table already has an open session', async () => {
      (tablesService.getById as jest.Mock).mockResolvedValue({
        id: 5,
        status: 'occupied',
      });
      (tablesService.getActiveSession as jest.Mock).mockResolvedValue({
        id: 99,
      });

      await expect(
        service.openSession({ table_id: 5 } as any),
      ).rejects.toBeInstanceOf(VendixHttpException);
      expect(prismaMock.orders.create).not.toHaveBeenCalled();
    });
  });

  describe('addItems', () => {
    it('rejects adding items to a closed session', async () => {
      prismaMock.table_sessions.findFirst.mockResolvedValue({
        id: 1,
        order_id: 100,
        closed_at: new Date(),
        table_id: 5,
        order: { state: 'draft' },
      });
      await expect(
        service.addItems(1, { items: [{ product_id: 1, quantity: 1 }] } as any),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });

    it('appends lines and re-derives totals in a single transaction', async () => {
      prismaMock.table_sessions.findFirst.mockResolvedValue({
        id: 1,
        order_id: 100,
        closed_at: null,
        table_id: 5,
        order: {
          id: 100,
          state: 'draft',
          grand_total: 0,
          subtotal_amount: 0,
          tax_amount: 0,
          discount_amount: 0,
          order_items: [],
        },
        table: { id: 5, name: 'Mesa 5', zone: null, status: 'occupied' },
      });
      prismaMock.products.findMany.mockResolvedValue([
        {
          id: 50,
          name: 'Hamburguesa',
          base_price: 25000,
          is_sellable: true,
          product_type: 'prepared',
          track_inventory: false,
        },
      ]);
      prismaMock.order_items.findMany.mockResolvedValue([
        { total_price: new Prisma.Decimal(50000), tax_amount_item: null },
      ]);
      prismaMock.order_items.create.mockResolvedValue({});
      prismaMock.orders.update.mockResolvedValue({});
      prismaMock.table_sessions.findFirst.mockResolvedValueOnce({
        id: 1,
        order_id: 100,
        closed_at: null,
        table_id: 5,
        order: { state: 'draft' },
        table: { id: 5, name: 'Mesa 5', zone: null, status: 'occupied' },
      });

      await service.addItems(1, {
        items: [{ product_id: 50, quantity: 2 }],
      } as any);
      expect(prismaMock.order_items.create).toHaveBeenCalled();
      expect(prismaMock.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100 },
          data: expect.objectContaining({
            grand_total: expect.any(Prisma.Decimal),
          }),
        }),
      );
    });
  });
});
