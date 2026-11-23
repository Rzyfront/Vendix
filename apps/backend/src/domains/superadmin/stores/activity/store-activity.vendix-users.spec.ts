import { Prisma } from '@prisma/client';
import { StoreActivityService } from './store-activity.service';
import { createPrismaMock } from '../../../../testing/prisma-mock';
import {
  vendixActorAuditWhere,
  vendixLoginAttemptSql,
  vendixUserWhere,
} from '@common/utils/vendix-user.util';

const STAFF_LOGIN_SQL = vendixLoginAttemptSql('la').sql;

function rawCalls(mock: jest.Mock): Prisma.Sql[] {
  return mock.mock.calls.map(([query]) => query as Prisma.Sql);
}

/**
 * "Actividad de tiendas" del Super Admin = actividad del personal. Los clientes
 * de ecommerce también tienen `store_users`, sesiones, eventos de auditoría e
 * inicios de sesión en la tienda, pero nada de eso entra en el conteo, el
 * puntaje, la serie ni el timeline. Los eventos de sistema (sin autor) sí.
 */
describe('Superadmin StoreActivityService — only Vendix staff activity', () => {
  const prisma = createPrismaMock({
    stores: ['findMany', 'findUnique'],
    orders: ['groupBy', 'findMany'],
    audit_logs: ['groupBy', 'findMany'],
    login_attempts: ['groupBy', 'findMany'],
    store_users: ['findMany'],
    user_sessions: ['findMany'],
  });
  let service: StoreActivityService;
  const staffLoginAt = new Date('2026-11-20T15:00:00Z');

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.stores.findMany.mockResolvedValue([
      { id: 12, name: 'Tienda', slug: 'tienda', is_active: true, organizations: { name: 'Org' } },
    ]);
    prisma.stores.findUnique.mockResolvedValue({
      id: 12,
      name: 'Tienda',
      slug: 'tienda',
      is_active: true,
      organizations: { name: 'Org' },
    });
    prisma.orders.groupBy.mockResolvedValue([]);
    prisma.orders.findMany.mockResolvedValue([]);
    prisma.audit_logs.groupBy.mockResolvedValue([]);
    prisma.audit_logs.findMany.mockResolvedValue([]);
    // La base ya filtró: solo vuelve el vínculo del empleado (user 5).
    prisma.store_users.findMany.mockResolvedValue([{ store_id: 12, user_id: 5 }]);
    prisma.user_sessions.findMany.mockResolvedValue([
      { user_id: 5, last_activity: new Date() },
    ]);
    // Inicios de sesión: la base aplica la regla de personal y devuelve solo
    // el del empleado.
    prisma.$queryRaw.mockImplementation(async (query: Prisma.Sql) =>
      query.sql.includes('GROUP BY la.store_id')
        ? [{ store_id: 12, last_attempted_at: staffLoginAt }]
        : [{ id: 41, email: 'ana@tienda.co', attempted_at: staffLoginAt }],
    );
    service = new StoreActivityService(prisma as never);
  });

  it('resolves memberships through Vendix users only and counts the staff session', async () => {
    const result = await service.getRanking({} as never);

    expect(prisma.store_users.findMany).toHaveBeenCalledWith({
      where: { store_id: { in: [12] }, user: vendixUserWhere() },
      select: { store_id: true, user_id: true },
    });
    expect(prisma.user_sessions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: { in: [5] } }),
      }),
    );
    expect(result.data[0]).toEqual(
      expect.objectContaining({ store_id: 12, active_users: 1, score: 2 }),
    );
  });

  it('counts audit events of staff or system only, in the ranking and the hours KPI', async () => {
    await service.getStats({} as never);

    const auditWheres = [
      ...prisma.audit_logs.groupBy.mock.calls.map(([a]) => a.where),
      ...prisma.audit_logs.findMany.mock.calls.map(([a]) => a.where),
    ];
    expect(auditWheres).toHaveLength(3);
    for (const where of auditWheres) {
      expect(where.AND).toEqual([vendixActorAuditWhere()]);
    }
  });

  it('takes the last sign-in of the ranking from staff sign-ins only, never from the raw table', async () => {
    const result = await service.getRanking({} as never);

    expect(prisma.login_attempts.groupBy).not.toHaveBeenCalled();
    const [query] = rawCalls(prisma.$queryRaw);
    expect(query.sql).toContain('GROUP BY la.store_id');
    expect(query.sql).toContain('la.success = true');
    expect(query.sql).toContain(STAFF_LOGIN_SQL);
    expect(query.values).toEqual(
      expect.arrayContaining([12, 'customer']),
    );
    expect(result.data[0].last_activity_at).not.toBeNull();
  });

  it('builds the detail timeline from staff events and staff sign-ins', async () => {
    prisma.audit_logs.findMany.mockResolvedValue([
      {
        id: 7,
        action: 'UPDATE',
        resource: 'products',
        resource_id: 3,
        created_at: new Date('2026-11-20T16:00:00Z'),
        users: { email: 'ana@tienda.co' },
      },
    ]);

    const result = await service.getDetail(12, {
      from: '2026-11-01',
      to: '2026-11-22',
    } as never);

    expect(prisma.login_attempts.findMany).not.toHaveBeenCalled();
    const timelineAudit = prisma.audit_logs.findMany.mock.calls
      .map(([a]) => a)
      .find((a) => a.orderBy);
    expect(timelineAudit.where).toEqual(
      expect.objectContaining({
        store_id: 12,
        AND: [vendixActorAuditWhere()],
      }),
    );
    const timelineLogins = rawCalls(prisma.$queryRaw).find((q) =>
      q.sql.includes('ORDER BY la.attempted_at DESC'),
    );
    expect(timelineLogins?.sql).toContain(STAFF_LOGIN_SQL);
    expect(timelineLogins?.values).toEqual(
      expect.arrayContaining([
        12,
        new Date('2026-11-01T00:00:00Z'),
        new Date('2026-11-23T00:00:00Z'),
        'customer',
      ]),
    );
    expect(result.summary.successful_logins).toBe(1);
    expect(result.timeline.map((item) => item.id)).toEqual([
      'audit-7',
      'login-41',
    ]);
  });

  it('counts staff sign-ins and staff/system events in the daily series', async () => {
    prisma.audit_logs.findMany.mockResolvedValue([
      { created_at: new Date('2026-11-20T16:00:00Z') },
    ]);

    const series = await service.getSeries(12, {
      from: '2026-11-19',
      to: '2026-11-21',
    } as never);

    expect(prisma.login_attempts.findMany).not.toHaveBeenCalled();
    expect(prisma.audit_logs.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ AND: [vendixActorAuditWhere()] }),
      select: { created_at: true },
    });
    expect(rawCalls(prisma.$queryRaw)[0].sql).toContain(STAFF_LOGIN_SQL);
    expect(series.days).toEqual([
      expect.objectContaining({ date: '2026-11-19', logins: 0, audit_events: 0 }),
      expect.objectContaining({ date: '2026-11-20', logins: 1, audit_events: 1 }),
      expect.objectContaining({ date: '2026-11-21', logins: 0, audit_events: 0 }),
    ]);
  });
});
