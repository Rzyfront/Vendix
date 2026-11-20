import { Test, TestingModule } from '@nestjs/testing';
import { StoreUsersService, parseIdList } from './store-users.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

/**
 * Regression for the "Buscar mesero" tip-selector leak: ecommerce customers
 * are also `store_users` rows (customers.service upserts a store_users link
 * on registration), so `staffLookup()` filtering only on `user.state:
 * 'active'` listed customer names in the POS payment waiter picker and
 * allowed tips to be assigned to a customer.
 *
 * Fix: require at least one `user_roles` entry whose role name is NOT
 * 'customer' — a staff member who is ALSO a registered customer still
 * appears (they hold a non-customer role too); a user whose only role is
 * 'customer' (or who has none) is excluded.
 */
describe('StoreUsersService — staffLookup excludes customers', () => {
  let service: StoreUsersService;

  const mockPrismaService = {
    store_users: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreUsersService,
        {
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<StoreUsersService>(StoreUsersService);
    jest.clearAllMocks();
  });

  it('sends a `where` that excludes users whose only role is customer', async () => {
    mockPrismaService.store_users.findMany.mockResolvedValue([]);

    await service.staffLookup({});

    expect(mockPrismaService.store_users.findMany).toHaveBeenCalledTimes(1);
    const call = mockPrismaService.store_users.findMany.mock.calls[0][0];

    expect(call.where).toEqual({
      user: {
        state: 'active',
        user_roles: {
          some: {
            roles: {
              name: { not: 'customer' },
            },
          },
        },
      },
    });
  });

  it('merges the role filter with the search OR clause', async () => {
    mockPrismaService.store_users.findMany.mockResolvedValue([]);

    await service.staffLookup({ search: 'jua' });

    const call = mockPrismaService.store_users.findMany.mock.calls[0][0];

    expect(call.where).toEqual({
      user: {
        state: 'active',
        user_roles: {
          some: {
            roles: {
              name: { not: 'customer' },
            },
          },
        },
        OR: [
          { first_name: { contains: 'jua', mode: 'insensitive' } },
          { last_name: { contains: 'jua', mode: 'insensitive' } },
        ],
      },
    });
  });

  it('maps rows to the {id, first_name, last_name} projection using users.id', async () => {
    mockPrismaService.store_users.findMany.mockResolvedValue([
      { id: 501, user: { id: 7, first_name: 'Ana', last_name: 'Waiter' } },
    ]);

    const result = await service.staffLookup({});

    expect(result).toEqual([{ id: 7, first_name: 'Ana', last_name: 'Waiter' }]);
  });

  it('clamps limit into the [1, 20] range', async () => {
    mockPrismaService.store_users.findMany.mockResolvedValue([]);

    await service.staffLookup({ limit: 500 });
    expect(
      mockPrismaService.store_users.findMany.mock.calls[0][0].take,
    ).toBe(20);

    await service.staffLookup({ limit: -3 });
    expect(
      mockPrismaService.store_users.findMany.mock.calls[1][0].take,
    ).toBe(1);
  });
});

/**
 * Regresión «Usuario #id»: el selector de responsable resolvía el nombre
 * buscando el id en la primera página de usuarios (clientes incluidos) o, en
 * modo staff, sin llamar al API. El filtro `ids` pide esas personas exactas.
 */
describe('StoreUsersService — resolver usuarios por ids', () => {
  let service: StoreUsersService;
  const prisma = {
    store_users: { findMany: jest.fn(), count: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreUsersService,
        { provide: StorePrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<StoreUsersService>(StoreUsersService);
    jest.clearAllMocks();
    prisma.store_users.findMany.mockResolvedValue([]);
    prisma.store_users.count.mockResolvedValue(0);
  });

  it('staffLookup con ids filtra por esos usuarios, sigue excluyendo clientes y no exige activo', async () => {
    await service.staffLookup({ ids: '42,7' });

    const call = prisma.store_users.findMany.mock.calls[0][0];
    expect(call.where.user.id).toEqual({ in: [42, 7] });
    expect(call.where.user.state).toBeUndefined();
    expect(call.where.user.user_roles).toEqual({
      some: { roles: { name: { not: 'customer' } } },
    });
    expect(call.take).toBe(2);
  });

  it('findAll con ids ignora la paginación y el filtro de activos', async () => {
    await service.findAll({ ids: '1500', page: 3, limit: 10 });

    const call = prisma.store_users.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ user: { id: { in: [1500] } } });
    expect(call.skip).toBe(0);
    expect(call.take).toBe(1);
  });

  it('findAll sin ids conserva el listado normal de activos', async () => {
    await service.findAll({ page: 2, limit: 10 });

    const call = prisma.store_users.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ user: { state: 'active' } });
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });

  it('parseIdList descarta basura, duplicados y vacíos', () => {
    expect(parseIdList(undefined)).toBeNull();
    expect(parseIdList('')).toBeNull();
    expect(parseIdList('3,3,x,0,9')).toEqual([3, 9]);
  });
});
