import { SuperAdminAuditService } from './audit.service';
import { createPrismaMock } from '../../../testing/prisma-mock';
import { vendixUserWhere } from '@common/utils/vendix-user.util';

/**
 * Auditoría del Super Admin: "Usuarios más activos" rankea solo usuarios de
 * Vendix. El filtro va dentro del GROUP BY (antes del `take: 10`), así un
 * cliente final con mucha actividad no ocupa un puesto ni deja el top corto.
 * Los conteos de eventos (total, por acción, por recurso) no cambian.
 */
describe('SuperAdminAuditService — top users are Vendix users only', () => {
  const prisma = createPrismaMock({
    audit_logs: ['count', 'groupBy'],
    users: ['findMany'],
  });
  const queryRaw = jest.fn();
  let service: SuperAdminAuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.audit_logs.count.mockResolvedValue(12);
    prisma.audit_logs.groupBy.mockImplementation(async (args) =>
      args.by[0] === 'user_id' ? [{ user_id: 5, _count: { id: 7 } }] : [],
    );
    prisma.users.findMany.mockResolvedValue([
      { id: 5, first_name: 'Ana', last_name: 'Staff', email: 'ana@example.com' },
    ]);
    queryRaw.mockResolvedValue([]);
    service = new SuperAdminAuditService({
      ...prisma,
      withoutScope: () => ({ $queryRaw: queryRaw }),
    } as never);
  });

  it('ranks top users among Vendix users and keeps event counts unfiltered', async () => {
    const result = await service.getAuditStats(undefined, undefined, {
      organization_id: 3,
    });

    const calls = prisma.audit_logs.groupBy.mock.calls.map(([a]) => a);
    const topCall = calls.find((a) => a.by[0] === 'user_id');
    expect(topCall).toEqual(
      expect.objectContaining({
        where: { organization_id: 3, users: vendixUserWhere() },
        take: 10,
      }),
    );
    for (const a of calls.filter((c) => c.by[0] !== 'user_id')) {
      expect(a.where).toEqual({ organization_id: 3 });
    }
    expect(prisma.audit_logs.count).toHaveBeenCalledWith({
      where: { organization_id: 3 },
    });
    expect(result.total_logs).toBe(12);
    expect(result.logs_by_user).toEqual([
      { user_id: '5', user_name: 'Ana Staff', count: 7 },
    ]);
  });
});
