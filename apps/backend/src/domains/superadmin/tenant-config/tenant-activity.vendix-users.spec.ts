import { Prisma } from '@prisma/client';
import { TenantActivityService } from './tenant-activity.service';
import { createPrismaMock } from '../../../testing/prisma-mock';
import {
  vendixActorAuditSql,
  vendixActorAuditWhere,
  vendixUserWhere,
  withVendixUser,
} from '@common/utils/vendix-user.util';

jest.mock('@common/utils/store-timezone.util', () => ({
  ...jest.requireActual('@common/utils/store-timezone.util'),
  resolveStoreTimezone: jest.fn().mockResolvedValue('America/Bogota'),
  resolveOrganizationTimezone: jest.fn().mockResolvedValue('America/Bogota'),
}));

/**
 * Pestaña "Actividad" de un tenant: los asientos, los activos 7/30 días, el
 * último acceso y "Usuarios más activos" hablan de usuarios de Vendix. Un
 * cliente de ecommerce con `store_users` en la tienda no ocupa asiento.
 *
 * Y toda cifra de eventos (acciones por día, acciones más frecuentes, módulos
 * usados, eventos sin tienda) cuenta solo eventos del personal o de sistema:
 * los de clientes finales no.
 */
describe('Superadmin TenantActivityService — seats and top users are Vendix users', () => {
  const db = createPrismaMock({
    users: ['findMany'],
    audit_logs: ['groupBy', 'count'],
    refresh_tokens: ['findMany'],
    store_weekly_reports: ['findFirst'],
  });
  const runner = {
    resolve: jest.fn().mockResolvedValue({
      organization_id: 3,
      store_id: null,
      organization_name: 'Org',
      store_name: null,
      store_is_active: null,
    }),
  };
  let service: TenantActivityService;

  beforeEach(() => {
    jest.clearAllMocks();
    db.users.findMany.mockImplementation(async (args) =>
      args.where?.id
        ? [{ id: 5, username: 'ana', email: 'ana@example.com', first_name: 'Ana', last_name: 'Staff' }]
        : [
            {
              id: 5,
              username: 'ana',
              email: 'ana@example.com',
              first_name: 'Ana',
              last_name: 'Staff',
              last_login: new Date('2026-11-20T10:00:00Z'),
            },
          ],
    );
    db.audit_logs.groupBy.mockImplementation(async (args) =>
      args.by[0] === 'user_id' && args._count
        ? [{ user_id: 5, _count: { _all: 7 } }]
        : [],
    );
    db.audit_logs.count.mockResolvedValue(0);
    db.refresh_tokens.findMany.mockResolvedValue([]);
    db.store_weekly_reports.findFirst.mockResolvedValue(null);
    service = new TenantActivityService(
      { withoutScope: () => db } as never,
      runner as never,
    );
  });

  it('builds the seat roster from Vendix users of the organization', async () => {
    const result = await service.getActivity(
      { kind: 'organization', organization_id: 3 },
      {} as never,
    );

    const rosterCall = db.users.findMany.mock.calls.find(([a]) => !a.where?.id);
    expect(rosterCall?.[0].where).toEqual(
      withVendixUser({ organization_id: 3 }),
    );
    expect(result.seats_total).toBe(1);
    expect(result.last_access).toEqual(new Date('2026-11-20T10:00:00Z'));
  });

  it('ranks top users only among Vendix users, before the top limit applies', async () => {
    const result = await service.getActivity(
      { kind: 'organization', organization_id: 3 },
      {} as never,
    );

    const topCall = db.audit_logs.groupBy.mock.calls.find(
      ([a]) => a.by[0] === 'user_id' && a._count,
    );
    expect(topCall?.[0].where).toEqual(
      expect.objectContaining({
        organization_id: 3,
        user_id: { not: null },
        users: vendixUserWhere(),
      }),
    );
    expect(result.top_users).toEqual([
      expect.objectContaining({ user_id: 5, count: 7, is_current_seat: true }),
    ]);
  });

  it('counts actions by day, top actions and modules over staff or system events only', async () => {
    await service.getActivity(
      { kind: 'organization', organization_id: 3 },
      {} as never,
    );

    const groupBys = db.audit_logs.groupBy.mock.calls.map(([a]) => a);
    const topActions = groupBys.find((a) => a.by[0] === 'action');
    const modules = groupBys.find((a) => a.by[0] === 'resource');
    const recentActors = groupBys.find(
      (a) => a.by[0] === 'user_id' && a._max,
    );
    for (const call of [topActions, modules, recentActors]) {
      expect(call?.where).toEqual(
        expect.objectContaining({
          organization_id: 3,
          AND: [vendixActorAuditWhere()],
        }),
      );
    }

    // `$queryRaw` se invoca como tagged template: se recompone la consulta.
    const [strings, ...values] = db.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const daily = Prisma.sql(strings, ...values);
    expect(daily.sql).toContain('FROM audit_logs al');
    expect(daily.sql).toContain(
      `al.organization_id = ? AND ${vendixActorAuditSql('al.user_id').sql}`,
    );
    expect(daily.values).toEqual(expect.arrayContaining([3, 'customer']));
  });

  it('counts unattributed events of a store over staff or system events only', async () => {
    await service.getActivity({ kind: 'store', store_id: 12 } as never, {} as never);

    expect(db.audit_logs.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organization_id: 3,
        store_id: null,
        AND: [vendixActorAuditWhere()],
      }),
    });
    const [strings, ...values] = db.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(Prisma.sql(strings, ...values).sql).toContain(
      `al.organization_id = ? AND al.store_id = ? AND ${vendixActorAuditSql('al.user_id').sql}`,
    );
  });
});
