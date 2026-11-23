import { DashboardService } from './dashboard.service';
import { vendixUserWhere } from '@common/utils/vendix-user.util';

const VENDIX_USER = vendixUserWhere();

/**
 * Prisma de mentira: cada `modelo.método` es un `jest.fn` con un valor neutro
 * (0, [], null, `_sum` vacío). Las pruebas sobrescriben solo lo que miran.
 */
function buildPrisma() {
  const defaults: Record<string, unknown> = {
    count: 0,
    findMany: [],
    findFirst: null,
    aggregate: { _sum: {} },
  };
  const models = new Map<string, Record<string, jest.Mock>>();
  return new Proxy({} as Record<string, Record<string, jest.Mock>>, {
    get(_target, model: string) {
      if (!models.has(model)) {
        models.set(
          model,
          new Proxy({} as Record<string, jest.Mock>, {
            get(methods, method: string) {
              if (!methods[method]) {
                methods[method] = jest
                  .fn()
                  .mockResolvedValue(defaults[method] ?? null);
              }
              return methods[method];
            },
          }),
        );
      }
      return models.get(model);
    },
  });
}

/** El `where` de usuarios incluye el criterio de usuario de Vendix. */
function isVendixUserWhere(where: unknown): boolean {
  return (
    !!where &&
    typeof where === 'object' &&
    Array.isArray((where as { AND?: unknown[] }).AND) &&
    JSON.stringify((where as { AND: unknown[] }).AND[0]) ===
      JSON.stringify(VENDIX_USER)
  );
}

describe('Superadmin DashboardService — users are Vendix users only', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: DashboardService;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new DashboardService(prisma as never);
  });

  it('counts total, monthly, weekly and trend users without end customers', async () => {
    prisma.users.count.mockResolvedValue(4);

    const result = await service.getDashboardStats();

    const calls = prisma.users.count.mock.calls;
    // total + mes anterior + mes actual + 7 días de la semana + 6 meses.
    expect(calls).toHaveLength(16);
    for (const [args] of calls) {
      expect(isVendixUserWhere(args?.where)).toBe(true);
    }
    expect(result.totalUsers).toBe(4);
    expect(result.weeklyData.every((day) => day.users === 4)).toBe(true);
    expect(result.monthlyTrend.every((month) => month.newUsers === 4)).toBe(
      true,
    );
  });

  it('feeds "recent activity" only with newly registered Vendix users', async () => {
    prisma.users.findMany.mockResolvedValue([
      {
        id: 9,
        first_name: 'Ana',
        last_name: 'Staff',
        email: 'ana@example.com',
        created_at: new Date('2026-11-20T10:00:00Z'),
      },
    ]);

    const result = await service.getDashboardStats();

    const [args] = prisma.users.findMany.mock.calls[0];
    expect(isVendixUserWhere(args.where)).toBe(true);
    expect(result.recentActivities).toContainEqual(
      expect.objectContaining({ id: 'user-9', entityName: 'Ana Staff' }),
    );
  });

  it('shows top organizations with their Vendix-user count, not their customers', async () => {
    prisma.organizations.findMany.mockImplementation(async (args) =>
      args?.take === 5
        ? [{ id: 3, name: 'Org', is_partner: false, _count: { stores: 2, users: 5 } }]
        : [],
    );

    const result = await service.getDashboardStats();

    const topCall = prisma.organizations.findMany.mock.calls.find(
      ([args]) => args?.take === 5,
    );
    expect(topCall?.[0].include._count.select).toEqual({
      stores: true,
      users: { where: VENDIX_USER },
    });
    expect(result.topOrganizations).toEqual([
      expect.objectContaining({ id: '3', stores: 2, users: 5 }),
    ]);
  });
});
