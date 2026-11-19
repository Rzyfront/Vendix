import { StaffProvisioningService } from './staff-provisioning.service';

/**
 * Incidente vendix-centro (2026-11-18): usuarios y clientes quedaron en una
 * tienda inactiva de la organización. Ningún camino de aprovisionamiento ni de
 * resolución de tienda de arranque puede elegir una tienda inactiva.
 */
describe('StaffProvisioningService — tiendas inactivas', () => {
  const service = new StaffProvisioningService(
    { withoutScope: jest.fn() } as any,
    {} as any,
    { ensureAssignmentUnchecked: jest.fn() } as any,
  );

  function makeDb(store: { is_active: boolean } | null) {
    return {
      stores: {
        findUnique: jest.fn().mockResolvedValue(store),
        findFirst: jest.fn(),
      },
      store_users: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      users: { update: jest.fn(), findUnique: jest.fn() },
      user_settings: { findUnique: jest.fn(), update: jest.fn() },
      roles: { findFirst: jest.fn() },
    };
  }

  describe('provisionStaffMembership', () => {
    it('en una tienda inactiva crea la membresía pero NO fija main_store_id', async () => {
      // Caso real: crear una tienda con "Tienda activa" apagado y con manager.
      const db = makeDb({ is_active: false });
      db.user_settings.findUnique.mockResolvedValue({ id: 1 });

      await service.provisionStaffMembership(db as any, {
        userId: 3628,
        storeId: 2,
        organizationId: 1,
      });

      expect(db.store_users.upsert).toHaveBeenCalledWith({
        where: { store_id_user_id: { store_id: 2, user_id: 3628 } },
        update: {},
        create: { store_id: 2, user_id: 3628 },
      });
      expect(db.users.update).not.toHaveBeenCalled();
    });

    it("con setMainStore 'if-empty' tampoco fija una tienda inactiva", async () => {
      const db = makeDb({ is_active: false });
      db.user_settings.findUnique.mockResolvedValue({ id: 1 });
      db.users.findUnique.mockResolvedValue({ main_store_id: null });

      await service.provisionStaffMembership(db as any, {
        userId: 3627,
        storeId: 2,
        organizationId: 1,
        setMainStore: 'if-empty',
      });

      expect(db.store_users.upsert).toHaveBeenCalled();
      expect(db.users.update).not.toHaveBeenCalled();
    });

    it('en una tienda activa fija main_store_id como siempre', async () => {
      const db = makeDb({ is_active: true });
      db.user_settings.findUnique.mockResolvedValue({ id: 1 });

      await service.provisionStaffMembership(db as any, {
        userId: 3628,
        storeId: 1,
        organizationId: 1,
      });

      expect(db.store_users.upsert).toHaveBeenCalled();
      expect(db.users.update).toHaveBeenCalledWith({
        where: { id: 3628 },
        data: { main_store_id: 1 },
      });
    });
  });

  describe('resolveStoreForStoreAdmin', () => {
    const user = { id: 3627, organization_id: 1, main_store_id: 2 };

    it('ignora una main_store inactiva y toma la membresía activa', async () => {
      const db = makeDb(null);
      db.stores.findUnique.mockResolvedValue({
        id: 2,
        slug: 'vendix-centro',
        organization_id: 1,
        is_active: false,
      });
      db.store_users.findFirst.mockResolvedValue({
        store: { id: 1, slug: 'vendix-crm', organization_id: 1 },
      });

      const store = await service.resolveStoreForStoreAdmin(
        user,
        true,
        db as any,
      );

      expect(store).toEqual({ id: 1, slug: 'vendix-crm', organization_id: 1 });
      // Ni auto-relación con la inactiva ni membresías en tiendas inactivas.
      expect(db.store_users.create).not.toHaveBeenCalled();
      expect(db.store_users.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id: 3627,
            store: { organization_id: 1, is_active: true },
          },
        }),
      );
    });

    it('el fallback de privilegio alto solo considera tiendas activas', async () => {
      const db = makeDb(null);
      db.store_users.findFirst.mockResolvedValue(null);
      db.stores.findFirst.mockResolvedValue(null);

      const store = await service.resolveStoreForStoreAdmin(
        { ...user, main_store_id: null },
        true,
        db as any,
      );

      expect(store).toBeNull();
      expect(db.stores.findFirst).toHaveBeenCalledWith({
        where: { organization_id: 1, is_active: true },
        orderBy: { id: 'asc' },
      });
      expect(db.store_users.create).not.toHaveBeenCalled();
    });
  });
});
