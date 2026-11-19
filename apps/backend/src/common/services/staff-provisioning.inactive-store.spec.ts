import { StaffProvisioningService } from './staff-provisioning.service';
import { ErrorCodes } from '../errors';

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
    it('rechaza una tienda inactiva sin escribir nada', async () => {
      const db = makeDb({ is_active: false });

      await expect(
        service.provisionStaffMembership(db as any, {
          userId: 3628,
          storeId: 2,
          organizationId: 1,
          roleName: 'admin',
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.AUTH_STORE_INACTIVE_001.code,
      });
      expect(db.store_users.upsert).not.toHaveBeenCalled();
      expect(db.users.update).not.toHaveBeenCalled();
    });

    it('rechaza una tienda que no existe', async () => {
      const db = makeDb(null);
      await expect(
        service.provisionStaffMembership(db as any, {
          userId: 1,
          storeId: 999,
          organizationId: 1,
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.AUTH_STORE_INACTIVE_001.code,
      });
    });

    it('aprovisiona normal en una tienda activa', async () => {
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
