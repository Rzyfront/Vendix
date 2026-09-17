import { KdsService } from './kds.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';

/**
 * KdsService — reactivación explícita, baja lógica y borrado físico.
 *
 * StorePrismaService y RequestContext van mockeados (mismo patrón que
 * tables.service.spec.ts). Cubre el contrato del CRUD completo:
 *  - findAll/findOne exponen `_count` (sesiones, productos, tickets) para que
 *    el frontend decida entre borrar y desactivar.
 *  - `activate` es idempotente y no toca `is_default`.
 *  - `remove` (soft) mantiene las guardas del default y la sesión abierta.
 *  - `hardDelete` bloquea default / sesión abierta / historial / productos y
 *    solo borra con `deleteMany({ id, store_id })` cuando no hay nada.
 */
describe('KdsService — activate + soft/hard delete', () => {
  let service: KdsService;
  let prisma: any;

  const STORE_ID = 100;

  const station = (overrides: Record<string, unknown> = {}) => ({
    id: 7,
    store_id: STORE_ID,
    name: 'Cocina caliente',
    code: 'HOT',
    description: null,
    is_active: true,
    is_default: false,
    location_id: null,
    _count: { sessions: 0, products: 0, tickets: 0 },
    ...overrides,
  });

  const expectCode = (promise: Promise<unknown>, code: string) =>
    promise.then(
      () => {
        throw new Error(`esperaba rechazo con ${code} pero resolvió`);
      },
      (err: unknown) => {
        expect(err).toBeInstanceOf(VendixHttpException);
        expect((err as VendixHttpException).errorCode).toBe(code);
      },
    );

  beforeEach(() => {
    prisma = {
      kds: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      kds_sessions: { findFirst: jest.fn(), count: jest.fn() },
      kitchen_tickets: { count: jest.fn() },
      products: { count: jest.fn() },
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: unknown) => unknown) =>
          Promise.resolve(cb(prisma)),
        ),
    };
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID } as never);
    service = new KdsService(prisma as unknown as StorePrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findAll / findOne', () => {
    it('findAll incluye _count de sesiones, productos y tickets', async () => {
      prisma.kds.findMany.mockResolvedValue([station()]);
      const rows = await service.findAll();
      expect(prisma.kds.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            _count: {
              select: { sessions: true, products: true, tickets: true },
            },
          },
        }),
      );
      expect(rows).toHaveLength(1);
    });

    it('findOne incluye _count y lanza KDS_NOT_FOUND si no existe', async () => {
      prisma.kds.findFirst.mockResolvedValueOnce(station());
      const row = await service.findOne(7);
      expect(row.id).toBe(7);
      expect(row._count).toEqual({ sessions: 0, products: 0, tickets: 0 });

      prisma.kds.findFirst.mockResolvedValueOnce(null);
      await expectCode(service.findOne(999), ErrorCodes.KDS_NOT_FOUND.code);
    });
  });

  describe('activate', () => {
    it('reactiva una estación inactiva (is_active=true)', async () => {
      prisma.kds.findFirst
        .mockResolvedValueOnce(station({ is_active: false }))
        .mockResolvedValueOnce(station({ is_active: true }));
      prisma.kds.updateMany.mockResolvedValue({ count: 1 });

      const row = await service.activate(7);
      expect(prisma.kds.updateMany).toHaveBeenCalledWith({
        where: { id: 7, store_id: STORE_ID },
        data: expect.objectContaining({ is_active: true }),
      });
      expect(row.is_active).toBe(true);
    });

    it('es idempotente: si ya está activa no escribe', async () => {
      prisma.kds.findFirst.mockResolvedValue(station({ is_active: true }));
      const row = await service.activate(7);
      expect(prisma.kds.updateMany).not.toHaveBeenCalled();
      expect(row.is_active).toBe(true);
    });

    it('reactiva aunque sea default (el default siempre puede estar activo)', async () => {
      prisma.kds.findFirst
        .mockResolvedValueOnce(
          station({ is_default: true, is_active: false }),
        )
        .mockResolvedValueOnce(station({ is_default: true, is_active: true }));
      prisma.kds.updateMany.mockResolvedValue({ count: 1 });

      const row = await service.activate(7);
      expect(prisma.kds.updateMany).toHaveBeenCalled();
      expect(row.is_active).toBe(true);
    });

    it('lanza KDS_NOT_FOUND si la estación no existe', async () => {
      prisma.kds.findFirst.mockResolvedValue(null);
      await expectCode(service.activate(999), ErrorCodes.KDS_NOT_FOUND.code);
    });
  });

  describe('remove (baja lógica)', () => {
    it('desactiva una estación normal sin sesión abierta', async () => {
      prisma.kds.findFirst
        .mockResolvedValueOnce(station({ is_active: true }))
        .mockResolvedValueOnce(station({ is_active: false }));
      prisma.kds_sessions.findFirst.mockResolvedValue(null);
      prisma.kds.updateMany.mockResolvedValue({ count: 1 });

      const row = await service.remove(7);
      expect(prisma.kds.updateMany).toHaveBeenCalledWith({
        where: { id: 7, store_id: STORE_ID },
        data: expect.objectContaining({ is_active: false }),
      });
      expect(row.is_active).toBe(false);
    });

    it('bloquea el default con KDS_DEFAULT_PROTECTED', async () => {
      prisma.kds.findFirst.mockResolvedValue(
        station({ is_default: true, is_active: true }),
      );
      await expectCode(
        service.remove(7),
        ErrorCodes.KDS_DEFAULT_PROTECTED.code,
      );
      expect(prisma.kds.updateMany).not.toHaveBeenCalled();
    });

    it('bloquea con KDS_HAS_OPEN_SESSION si hay turno abierto', async () => {
      prisma.kds.findFirst.mockResolvedValue(station());
      prisma.kds_sessions.findFirst.mockResolvedValue({ id: 11 });
      await expectCode(
        service.remove(7),
        ErrorCodes.KDS_HAS_OPEN_SESSION.code,
      );
      expect(prisma.kds.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('hardDelete (borrado físico)', () => {
    const cleanHistory = () => {
      prisma.kds_sessions.findFirst.mockResolvedValue(null);
      prisma.kds_sessions.count.mockResolvedValue(0);
      prisma.kitchen_tickets.count.mockResolvedValue(0);
      prisma.products.count.mockResolvedValue(0);
    };

    it('borra la fila sin historial con deleteMany scopeado por tienda', async () => {
      prisma.kds.findFirst.mockResolvedValue(station());
      cleanHistory();
      prisma.kds.deleteMany.mockResolvedValue({ count: 1 });

      const out = await service.hardDelete(7);
      expect(prisma.kds.deleteMany).toHaveBeenCalledWith({
        where: { id: 7, store_id: STORE_ID },
      });
      expect(out).toEqual({ deleted: true, id: 7 });
    });

    it('remove(id, true) delega al borrado físico', async () => {
      prisma.kds.findFirst.mockResolvedValue(station());
      cleanHistory();
      prisma.kds.deleteMany.mockResolvedValue({ count: 1 });

      const out = await service.remove(7, true);
      expect(prisma.kds.deleteMany).toHaveBeenCalled();
      expect(out).toEqual({ deleted: true, id: 7 });
    });

    it('bloquea el default con KDS_DEFAULT_PROTECTED', async () => {
      prisma.kds.findFirst.mockResolvedValue(station({ is_default: true }));
      await expectCode(
        service.hardDelete(7),
        ErrorCodes.KDS_DEFAULT_PROTECTED.code,
      );
      expect(prisma.kds.deleteMany).not.toHaveBeenCalled();
    });

    it('la sesión abierta reporta KDS_HAS_OPEN_SESSION (antes que historial)', async () => {
      prisma.kds.findFirst.mockResolvedValue(station());
      prisma.kds_sessions.findFirst.mockResolvedValue({ id: 11 });
      await expectCode(
        service.hardDelete(7),
        ErrorCodes.KDS_HAS_OPEN_SESSION.code,
      );
      expect(prisma.kds.deleteMany).not.toHaveBeenCalled();
    });

    it('sesiones cerradas reportan KDS_HAS_HISTORY con conteos', async () => {
      prisma.kds.findFirst.mockResolvedValue(station());
      prisma.kds_sessions.findFirst.mockResolvedValue(null);
      prisma.kds_sessions.count.mockResolvedValue(2);
      prisma.kitchen_tickets.count.mockResolvedValue(0);
      await expectCode(
        service.hardDelete(7),
        ErrorCodes.KDS_HAS_HISTORY.code,
      );
      expect(prisma.kds.deleteMany).not.toHaveBeenCalled();
    });

    it('tickets reportan KDS_HAS_HISTORY aunque no haya sesiones', async () => {
      prisma.kds.findFirst.mockResolvedValue(station());
      prisma.kds_sessions.findFirst.mockResolvedValue(null);
      prisma.kds_sessions.count.mockResolvedValue(0);
      prisma.kitchen_tickets.count.mockResolvedValue(5);
      await expectCode(
        service.hardDelete(7),
        ErrorCodes.KDS_HAS_HISTORY.code,
      );
      expect(prisma.kds.deleteMany).not.toHaveBeenCalled();
    });

    it('productos asignados reportan KDS_HAS_PRODUCTS', async () => {
      prisma.kds.findFirst.mockResolvedValue(station());
      cleanHistory();
      prisma.products.count.mockResolvedValue(3);
      await expectCode(
        service.hardDelete(7),
        ErrorCodes.KDS_HAS_PRODUCTS.code,
      );
      expect(prisma.kds.deleteMany).not.toHaveBeenCalled();
    });

    it('sin contexto de tienda lanza STORE_CONTEXT_001', async () => {
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue(undefined as never);
      await expectCode(
        service.hardDelete(7),
        ErrorCodes.STORE_CONTEXT_001.code,
      );
    });
  });
});
