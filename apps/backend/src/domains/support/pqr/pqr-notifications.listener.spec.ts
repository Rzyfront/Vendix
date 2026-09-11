import {
  PQR_STORE_RESPONSE_ROLE_NAMES,
  PQR_SUPER_ADMIN_ROLE_NAMES,
  PqrNotificationsListener,
} from './pqr-notifications.listener';

/**
 * F-006 — el listener de PQR matchea los roles canónicos en los 3 sitios.
 *
 * Postgres compara `=` case-sensitive y el canónico (seed +
 * `roles.service.ts`) es `super_admin` en minúsculas: el literal exacto
 * `'SUPER_ADMIN'` no matcheaba a nadie. La rama store de `response_sent`
 * solo matcheaba `'STORE_ADMIN'` mientras `handlePqrCreated` ya avisa a
 * owner/admin/manager.
 */
describe('PqrNotificationsListener — F-006 roles canónicos', () => {
  const makePrisma = () => ({
    users: { findMany: jest.fn().mockResolvedValue([]) },
    support_tickets: { findUnique: jest.fn() },
    notifications: { createMany: jest.fn().mockResolvedValue({}) },
  });

  it('los 3 sitios comparten las constantes (misma forma que handlePqrCreated)', () => {
    expect(PQR_SUPER_ADMIN_ROLE_NAMES).toEqual(['super_admin', 'SUPER_ADMIN']);
    expect(PQR_STORE_RESPONSE_ROLE_NAMES).toEqual(
      expect.arrayContaining(['owner', 'admin', 'manager']),
    );
    expect(PQR_STORE_RESPONSE_ROLE_NAMES).toEqual(
      expect.arrayContaining(['STORE_ADMIN', 'store_admin']),
    );
  });

  it('response_sent con tienda avisa a owner/admin/manager (no solo STORE_ADMIN)', async () => {
    const prisma: any = makePrisma();
    prisma.support_tickets.findUnique.mockResolvedValue({
      id: 7,
      ticket_number: 'PQR-7',
      title: 'Consulta',
      store_id: 10,
      organization_id: 1,
    });
    prisma.users.findMany.mockResolvedValue([{ id: 11 }, { id: 12 }]);
    const listener = new PqrNotificationsListener(prisma);

    await listener.handlePqrResponseSent({ ticket_id: 7 } as any);

    const where = prisma.users.findMany.mock.calls[0][0].where;
    expect(where.user_roles.some.roles.name).toEqual({
      in: PQR_STORE_RESPONSE_ROLE_NAMES,
    });
    expect(where.user_roles.some.roles.name.in).toEqual(
      expect.arrayContaining(['owner', 'admin', 'manager']),
    );
    // Los dos admins reciben su fila con target propio.
    const rows = prisma.notifications.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.data.target_user_id)).toEqual([11, 12]);
  });

  it('response_sent sin tienda matchea `super_admin` minúsculas', async () => {
    const prisma: any = makePrisma();
    prisma.support_tickets.findUnique.mockResolvedValue({
      id: 9,
      ticket_number: 'PQR-9',
      title: 'Anónima',
      store_id: null,
      organization_id: null,
    });
    prisma.users.findMany.mockResolvedValue([{ id: 1 }]);
    const listener = new PqrNotificationsListener(prisma);

    await listener.handlePqrResponseSent({ ticket_id: 9 } as any);

    const where = prisma.users.findMany.mock.calls[0][0].where;
    expect(where.user_roles.some.roles.name).toEqual({
      in: PQR_SUPER_ADMIN_ROLE_NAMES,
    });
    expect(where.user_roles.some.roles.name.in).toContain('super_admin');
    expect(prisma.notifications.createMany).toHaveBeenCalled();
  });
});
