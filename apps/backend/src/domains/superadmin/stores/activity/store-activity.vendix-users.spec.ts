import { StoreActivityService } from './store-activity.service';
import { createPrismaMock } from '../../../../testing/prisma-mock';
import { vendixUserWhere } from '@common/utils/vendix-user.util';

/**
 * "Usuarios" del ranking de actividad = personal de la tienda con sesión en la
 * ventana. Los clientes de ecommerce también tienen `store_users`, pero no
 * entran ni en el conteo ni en el puntaje.
 */
describe('Superadmin StoreActivityService — active users are store staff only', () => {
  const prisma = createPrismaMock({
    stores: ['findMany'],
    orders: ['groupBy', 'findMany'],
    audit_logs: ['groupBy', 'findMany'],
    login_attempts: ['groupBy'],
    store_users: ['findMany'],
    user_sessions: ['findMany'],
  });
  let service: StoreActivityService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.stores.findMany.mockResolvedValue([
      { id: 12, name: 'Tienda', slug: 'tienda', is_active: true, organizations: { name: 'Org' } },
    ]);
    prisma.orders.groupBy.mockResolvedValue([]);
    prisma.orders.findMany.mockResolvedValue([]);
    prisma.audit_logs.groupBy.mockResolvedValue([]);
    prisma.audit_logs.findMany.mockResolvedValue([]);
    prisma.login_attempts.groupBy.mockResolvedValue([]);
    // La base ya filtró: solo vuelve el vínculo del empleado (user 5).
    prisma.store_users.findMany.mockResolvedValue([{ store_id: 12, user_id: 5 }]);
    prisma.user_sessions.findMany.mockResolvedValue([
      { user_id: 5, last_activity: new Date() },
    ]);
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
});
