import { TenantActivityService } from './tenant-activity.service';
import { createPrismaMock } from '../../../testing/prisma-mock';
import {
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
});
