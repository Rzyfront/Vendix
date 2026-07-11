import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { TablesService } from './tables.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

describe('TablesService — CRUD + floor map (Fase E smoke)', () => {
  let service: TablesService;
  let prismaMock: any;
  let context: any;

  const STORE_ID = 100;

  beforeEach(() => {
    context = {
      store_id: STORE_ID,
      organization_id: 1,
      user_id: 1,
      is_super_admin: false,
    };

    prismaMock = {
      tables: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      table_sessions: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      bookings: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
    };

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(context);

    service = new TablesService(prismaMock as any, {
      generateDataUrl: jest.fn(),
    } as any);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('rejects duplicate (store_id, name) with a VendixHttpException', async () => {
      prismaMock.tables.findFirst.mockResolvedValueOnce({
        id: 1,
        name: 'Mesa 1',
      });
      await expect(
        service.create({ name: 'Mesa 1' } as any),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });

    it('creates a row on first occurrence', async () => {
      prismaMock.tables.findFirst.mockResolvedValueOnce(null);
      prismaMock.tables.create.mockResolvedValueOnce({
        id: 99,
        name: 'Mesa 9',
        store_id: STORE_ID,
        status: 'available',
      });
      const result = await service.create({ name: 'Mesa 9' } as any);
      expect(result.id).toBe(99);
      expect(prismaMock.tables.create).toHaveBeenCalled();
    });
  });

  describe('floorMap', () => {
    it('returns tables annotated with effective_status and active session', async () => {
      prismaMock.tables.findMany.mockResolvedValueOnce([
        {
          id: 1,
          store_id: STORE_ID,
          name: 'Mesa 1',
          zone: 'Salón',
          capacity: 4,
          status: 'available',
          pos_x: 0,
          pos_y: 0,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 2,
          store_id: STORE_ID,
          name: 'Mesa 2',
          zone: 'Salón',
          capacity: 4,
          status: 'available',
          pos_x: 1,
          pos_y: 0,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);
      prismaMock.table_sessions.findMany.mockResolvedValueOnce([
        {
          id: 50,
          table_id: 2,
          order_id: 9001,
          opened_by: 1,
          opened_at: new Date(),
          closed_at: null,
          guest_count: 3,
        },
      ]);

      const map = await service.floorMap();
      expect(map).toHaveLength(2);
      expect(map[0].effective_status).toBe('available');
      expect(map[0].active_session).toBeNull();
      expect(map[1].effective_status).toBe('occupied');
      expect(map[1].active_session?.id).toBe(50);
    });
  });

  describe('remove', () => {
    it('rejects when sessions exist (audit trail protection)', async () => {
      prismaMock.tables.findFirst.mockResolvedValueOnce({ id: 1 });
      prismaMock.table_sessions.count.mockResolvedValueOnce(2);
      await expect(service.remove(1)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
      expect(prismaMock.tables.delete).not.toHaveBeenCalled();
    });
  });
});
