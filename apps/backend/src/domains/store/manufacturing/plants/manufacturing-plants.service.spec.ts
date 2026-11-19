import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { ManufacturingPlantsService, OPEN_ORDER_STATUSES } from './manufacturing-plants.service';

type Row = Record<string, any>;

/**
 * QUI-1013 — production plants. The Prisma double stands for the store-scoped
 * client: a row of another store is simply not returned by `findFirst`
 * (the scoping itself is pinned in store-prisma.manufacturing-plants.spec.ts).
 */
describe('ManufacturingPlantsService', () => {
  let prisma: any;
  let service: ManufacturingPlantsService;
  let plants: Row[];

  const plant = (over: Row = {}): Row => ({
    id: 1,
    store_id: 1,
    name: 'Planta principal',
    input_location_id: 10,
    output_location_id: 20,
    manager_user_id: null,
    is_active: true,
    ...over,
  });

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 1, user_id: 42 } as any);
    plants = [plant()];
    prisma = {
      manufacturing_plants: {
        findMany: jest.fn(async ({ where, take }: Row = {}) => {
          const rows = plants
            .filter((p) => where?.is_active === undefined || p.is_active === where.is_active)
            .sort((a, b) => a.id - b.id);
          return take ? rows.slice(0, take) : rows;
        }),
        findFirst: jest.fn(async ({ where }: Row) => {
          if (where?.name) return null; // no name clash unless a test says so
          return plants.find((p) => p.id === where.id) ?? null;
        }),
        create: jest.fn(async ({ data }: Row) => {
          const row = { id: 99, ...data };
          plants.push(row);
          return { id: row.id };
        }),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      inventory_locations: { findFirst: jest.fn().mockResolvedValue({ id: 10 }) },
      store_users: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      production_orders: { count: jest.fn().mockResolvedValue(0) },
    };
    service = new ManufacturingPlantsService(prisma);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('create', () => {
    const dto = { name: 'Camisas', input_location_id: 11, output_location_id: 12 };

    it('creates the plant in the current store, active, without manager by default', async () => {
      const created = await service.create(dto);
      expect(prisma.manufacturing_plants.create).toHaveBeenCalledWith({
        data: {
          store_id: 1,
          name: 'Camisas',
          input_location_id: 11,
          output_location_id: 12,
          manager_user_id: null,
          is_active: true,
        },
        select: { id: true },
      });
      expect(created).toMatchObject({ id: 99, name: 'Camisas' });
    });

    it('rejects a location that is not in the store', async () => {
      prisma.inventory_locations.findFirst.mockResolvedValueOnce(null);
      await expect(service.create(dto)).rejects.toMatchObject({
        errorCode: 'MFG_INVALID_LOCATION',
      });
      expect(prisma.manufacturing_plants.create).not.toHaveBeenCalled();
    });

    it('rejects a manager who is not active staff of the store', async () => {
      prisma.store_users.findFirst.mockResolvedValueOnce(null);
      await expect(service.create({ ...dto, manager_user_id: 7 })).rejects.toMatchObject({
        errorCode: 'MFG_PLANT_INVALID_MANAGER',
      });
      expect(prisma.store_users.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ user_id: 7 }) }),
      );
      expect(prisma.manufacturing_plants.create).not.toHaveBeenCalled();
    });

    it('rejects a repeated name, ignoring case', async () => {
      prisma.manufacturing_plants.findFirst.mockResolvedValueOnce({ id: 1 });
      await expect(service.create({ ...dto, name: 'planta PRINCIPAL' })).rejects.toMatchObject({
        errorCode: 'MFG_PLANT_NAME_DUPLICATE',
      });
      expect(prisma.manufacturing_plants.findFirst.mock.calls[0][0].where).toEqual({
        name: { equals: 'planta PRINCIPAL', mode: 'insensitive' },
      });
      expect(prisma.manufacturing_plants.create).not.toHaveBeenCalled();
    });

    it('maps a unique-index race (P2002) to the duplicate-name error', async () => {
      prisma.manufacturing_plants.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );
      await expect(service.create(dto)).rejects.toMatchObject({
        errorCode: 'MFG_PLANT_NAME_DUPLICATE',
      });
    });

    it('requires a store in context', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({} as any);
      await expect(service.create(dto)).rejects.toMatchObject({
        errorCode: 'STORE_CONTEXT_001',
      });
    });
  });

  describe('update / deactivate', () => {
    it('edits only the fields sent, with a store-scoped write', async () => {
      await service.update(1, { name: 'Pantalones', manager_user_id: null });
      const args = prisma.manufacturing_plants.updateMany.mock.calls[0][0];
      expect(args.where).toEqual({ id: 1 });
      expect(args.data).toMatchObject({ name: 'Pantalones', manager_user_id: null });
      expect(args.data).not.toHaveProperty('input_location_id');
      expect(args.data).not.toHaveProperty('is_active');
    });

    it('does not deactivate a plant with orders still in production', async () => {
      prisma.production_orders.count.mockResolvedValueOnce(2);
      await expect(service.update(1, { is_active: false })).rejects.toMatchObject({
        errorCode: 'MFG_PLANT_HAS_OPEN_ORDERS',
      });
      expect(prisma.production_orders.count).toHaveBeenCalledWith({
        where: { plant_id: 1, status: { in: [...OPEN_ORDER_STATUSES] } },
      });
      expect(prisma.manufacturing_plants.updateMany).not.toHaveBeenCalled();
    });

    it('deactivates a plant without open orders', async () => {
      await service.update(1, { is_active: false });
      expect(prisma.manufacturing_plants.updateMany.mock.calls[0][0].data.is_active).toBe(false);
    });

    it("another store's plant is not found and nothing is written", async () => {
      await expect(service.update(555, { name: 'X' })).rejects.toMatchObject({
        errorCode: 'MFG_PLANT_NOT_FOUND',
      });
      expect(prisma.manufacturing_plants.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('marks the main plant (first active by id) and hides inactive ones by default', async () => {
      plants = [plant({ id: 1, is_active: false }), plant({ id: 2, name: 'B' }), plant({ id: 3, name: 'C' })];
      const rows = await service.findAll();
      expect(rows.map((r) => [r.id, r.is_main])).toEqual([
        [2, true],
        [3, false],
      ]);
      const all = await service.findAll({ include_inactive: true });
      expect(all.map((r) => [r.id, r.is_main])).toEqual([
        [1, false],
        [2, true],
        [3, false],
      ]);
    });
  });

  describe('resolveForOrder', () => {
    it('one active plant: the order gets it without choosing', async () => {
      await expect(service.resolveForOrder()).resolves.toBe(1);
    });

    it('no plant: the order stays without plant (pre-plant behavior)', async () => {
      plants = [];
      await expect(service.resolveForOrder()).resolves.toBeNull();
    });

    it('several active plants and none chosen: MFG_PLANT_REQUIRED', async () => {
      plants = [plant({ id: 1 }), plant({ id: 2, name: 'B' })];
      await expect(service.resolveForOrder()).rejects.toMatchObject({
        errorCode: 'MFG_PLANT_REQUIRED',
      });
    });

    it('several plants, one inactive: the only active one is used', async () => {
      plants = [plant({ id: 1, is_active: false }), plant({ id: 2, name: 'B' })];
      await expect(service.resolveForOrder()).resolves.toBe(2);
    });

    it('an explicit active plant is kept', async () => {
      plants = [plant({ id: 1 }), plant({ id: 2, name: 'B' })];
      await expect(service.resolveForOrder(2)).resolves.toBe(2);
    });

    it('an explicit inactive plant is rejected', async () => {
      plants = [plant({ id: 1 }), plant({ id: 2, name: 'B', is_active: false })];
      await expect(service.resolveForOrder(2)).rejects.toMatchObject({
        errorCode: 'MFG_PLANT_INACTIVE',
      });
    });

    it("another store's plant id is not found", async () => {
      await expect(service.resolveForOrder(555)).rejects.toMatchObject({
        errorCode: 'MFG_PLANT_NOT_FOUND',
      });
    });
  });
});
