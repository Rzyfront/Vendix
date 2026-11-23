import { Prisma } from '@prisma/client';
import { SuperAdminAuditService } from './audit.service';
import { createPrismaMock } from '../../../testing/prisma-mock';
import {
  vendixActorAuditSql,
  vendixActorAuditWhere,
  vendixUserWhere,
} from '@common/utils/vendix-user.util';

/**
 * Auditoría del Super Admin = actividad del personal de Vendix.
 *
 * - El listado y TODOS los totales (por acción, recurso, usuario y día)
 *   excluyen los eventos cuyo autor es un cliente final. Los eventos de
 *   sistema (`user_id` nulo) se conservan.
 * - "Usuarios más activos" además exige autor de Vendix, dentro del GROUP BY
 *   (antes del `take: 10`), así un cliente final no ocupa un puesto.
 */
describe('SuperAdminAuditService — only Vendix staff or system events', () => {
  const prisma = createPrismaMock({
    audit_logs: ['count', 'groupBy', 'findMany'],
    users: ['findMany'],
  });
  const queryRaw = jest.fn();
  let service: SuperAdminAuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.audit_logs.count.mockResolvedValue(12);
    prisma.audit_logs.findMany.mockResolvedValue([]);
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

  it('counts totals by action and resource over staff or system events only', async () => {
    const result = await service.getAuditStats(undefined, undefined, {
      organization_id: 3,
    });

    const staffOrSystem = { organization_id: 3, AND: [vendixActorAuditWhere()] };
    expect(prisma.audit_logs.count).toHaveBeenCalledWith({
      where: staffOrSystem,
    });
    const calls = prisma.audit_logs.groupBy.mock.calls.map(([a]) => a);
    for (const a of calls.filter((c) => c.by[0] !== 'user_id')) {
      expect(a.where).toEqual(staffOrSystem);
    }
    expect(result.total_logs).toBe(12);
  });

  it('ranks top users among Vendix users, before the top limit applies', async () => {
    const result = await service.getAuditStats(undefined, undefined, {
      organization_id: 3,
    });

    const topCall = prisma.audit_logs.groupBy.mock.calls
      .map(([a]) => a)
      .find((a) => a.by[0] === 'user_id');
    expect(topCall).toEqual(
      expect.objectContaining({
        where: {
          organization_id: 3,
          AND: [vendixActorAuditWhere()],
          users: vendixUserWhere(),
        },
        take: 10,
      }),
    );
    expect(result.logs_by_user).toEqual([
      { user_id: '5', user_name: 'Ana Staff', count: 7 },
    ]);
  });

  it('applies the same rule to the raw daily series, on the qualified author column', async () => {
    await service.getAuditStats(undefined, undefined, {
      organization_id: 3,
      store_id: 9,
    });

    // `$queryRaw` se invoca como tagged template: se recompone la consulta.
    const [strings, ...values] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const query = Prisma.sql(strings, ...values);
    expect(query.sql).toContain('FROM audit_logs al');
    expect(query.sql).toContain(vendixActorAuditSql('al.user_id').sql);
    expect(query.sql).toContain('al.organization_id = ?');
    expect(query.sql).toContain('al.store_id = ?');
    expect(query.values).toEqual(expect.arrayContaining(['customer', 3, 9]));
  });

  it('lists only staff or system events, keeping the caller filters', async () => {
    await service.getAuditLogs({ store_id: 9, action: 'LOGIN' as never });

    expect(prisma.audit_logs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          store_id: 9,
          action: 'LOGIN',
          AND: [vendixActorAuditWhere()],
        },
      }),
    );
  });
});
