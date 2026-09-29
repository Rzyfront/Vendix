import { Test, TestingModule } from '@nestjs/testing';
import { StoreUsersService } from './store-users.service';
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
